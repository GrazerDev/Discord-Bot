import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { formatDuration, pick, shuffle } from './helpers.js';

/* ────────────────────────────────────────────────────────────────────────────
 * @discordjs/voice is loaded lazily so that a missing/broken install only
 * disables music instead of crashing the whole bot.
 * ──────────────────────────────────────────────────────────────────────────── */
let voice = null;
let voiceError = null;

export async function loadVoice() {
  if (voice || voiceError) return voice;
  try {
    voice = await import('@discordjs/voice');
  } catch (err) {
    voiceError = err.message;
    console.warn('[music] @discordjs/voice not available:', err.message);
  }
  return voice;
}

/* ── binary detection ─────────────────────────────────────────────────────── */
function probe(bin, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

let binariesOk = null;
export async function checkBinaries() {
  if (binariesOk !== null) return binariesOk;
  const [ytdlp, ffmpeg] = await Promise.all([probe(config.music.ytdlp), probe(config.music.ffmpeg, ['-version'])]);
  binariesOk = { ytdlp, ffmpeg, ok: ytdlp && ffmpeg };
  if (!binariesOk.ok) {
    console.warn(`[music] missing binaries → yt-dlp:${ytdlp} ffmpeg:${ffmpeg}`);
  }
  return binariesOk;
}

/* ── yt-dlp metadata ──────────────────────────────────────────────────────── */
function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.music.ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && out.trim()) resolve(out);
      else reject(new Error((err.trim().split('\n').pop() || `yt-dlp exited with ${code}`).slice(0, 200)));
    });
  });
}

const youtubeUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

/** Turn a search term or URL into a list of tracks. */
export async function resolveTracks(query, requester) {
  const target = /^https?:\/\//i.test(query) ? query : `ytsearch1:${query}`;
  const raw = await runYtdlp(['-J', '--no-warnings', '--flat-playlist', '--no-playlist', target]);
  const data = JSON.parse(raw);

  const toTrack = (entry) => ({
    title: entry.title ?? 'Unknown title',
    url: entry.webpage_url ?? (entry.id ? youtubeUrl(entry.id) : entry.url),
    duration: Math.round(entry.duration ?? 0),
    thumbnail: entry.thumbnails?.at(-1)?.url ?? entry.thumbnail ?? null,
    requester,
  });

  if (!data.entries?.length) {
    if (!data.title) throw new Error('Nothing found for that query.');
    return [toTrack(data)];
  }
  return data.entries.filter((e) => e && (e.id || e.webpage_url)).slice(0, 50).map(toTrack);
}

/* ── audio pipeline: yt-dlp → ffmpeg → Opus ───────────────────────────────── */
/**
 * Default path lets ffmpeg emit Ogg Opus, which Node forwards to Discord as
 * packets — no JavaScript encoding at all, so it survives on a 0.1 CPU free
 * instance. MUSIC_STREAM=raw switches to PCM + opusscript if that ever misbehaves.
 */
function createAudioStream(url, notify = () => {}) {
  const useRaw = config.music.stream === 'raw';

  const ytdlp = spawn(config.music.ytdlp, [
    '-f', 'bestaudio/best',
    '--no-playlist',
    '--quiet',
    '--no-warnings',
    '-o', '-',
    url,
  ]);

  const ffmpegArgs = useRaw
    ? ['-i', 'pipe:0', '-analyzeduration', '0', '-loglevel', 'error', '-vn', '-ac', '2', '-f', 's16le', '-ar', '48000', 'pipe:1']
    : ['-i', 'pipe:0', '-analyzeduration', '0', '-loglevel', 'error', '-vn', '-c:a', 'libopus', '-b:a', '96k', '-f', 'ogg', 'pipe:1'];

  const ffmpeg = spawn(config.music.ffmpeg, ffmpegArgs);

  let ytdlpErr = '';
  let ffmpegErr = '';
  ytdlp.stderr.on('data', (d) => { ytdlpErr = (ytdlpErr + d).slice(-2000); });
  ffmpeg.stderr.on('data', (d) => { ffmpegErr = (ffmpegErr + d).slice(-2000); });

  ytdlp.stdout.pipe(ffmpeg.stdin);

  let reported = false;
  const report = (what, detail) => {
    if (reported) return;
    reported = true;
    const hint = /sign in to confirm|not a bot|cookies|429/i.test(detail)
      ? '\nYouTube is challenging this host’s IP. Music from datacenter IPs often needs cookies — see /musicdebug.'
      : '';
    console.warn(`[music] ${what}: ${detail.split('\n').slice(-2).join(' ')}`);
    notify(`⚠️ **${what}**\n\`\`\`\n${detail.slice(-400)}\n\`\`\`${hint}`);
  };

  ytdlp.on('error', (err) => report('yt-dlp could not start', err.message));
  ffmpeg.on('error', (err) => report('ffmpeg could not start', err.message));
  ytdlp.on('close', (code) => {
    if (code !== 0) report(`yt-dlp exited with code ${code}`, ytdlpErr.trim() || 'no output');
  });
  ffmpeg.on('close', (code) => {
    if (code !== 0 && code !== null) report(`ffmpeg exited with code ${code}`, ffmpegErr.trim() || 'no output');
  });
  ffmpeg.stdin.on('error', () => {});

  const kill = () => {
    try { ytdlp.kill('SIGKILL'); } catch { /* noop */ }
    try { ffmpeg.kill('SIGKILL'); } catch { /* noop */ }
  };
  ffmpeg.stdout.on('close', kill);

  return { stream: ffmpeg.stdout, useRaw, kill, stderr: () => ({ ytdlpErr, ffmpegErr }) };
}

/* ── diagnostics for /musicdebug ──────────────────────────────────────────── */
export async function diagnose() {
  const out = { binaries: await checkBinaries(), version: null, search: null, url: null, streamType: config.music.stream, bytes: 0, error: null, stderr: null };

  try {
    out.version = (await runYtdlp(['--version'])).trim();
  } catch (err) {
    out.error = `yt-dlp --version failed: ${err.message}`;
    return out;
  }

  try {
    const raw = await runYtdlp(['-J', '--no-warnings', '--flat-playlist', '--no-playlist', 'ytsearch1:lofi hip hop']);
    const data = JSON.parse(raw);
    const entry = data.entries?.[0] ?? data;
    out.search = entry?.title ?? null;
    out.url = entry?.webpage_url ?? entry?.url ?? null;
  } catch (err) {
    out.error = `search failed: ${err.message}`;
    return out;
  }

  if (!out.url) return out;

  const probe = createAudioStream(out.url, () => {});
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 7000);
    probe.stream.once('data', (chunk) => {
      out.bytes += chunk.length;
      clearTimeout(timer);
      resolve();
    });
    probe.stream.once('end', () => { clearTimeout(timer); resolve(); });
    probe.stream.once('error', () => { clearTimeout(timer); resolve(); });
  });
  out.bytes = out.bytes || 0;
  out.stderr = probe.stderr();
  probe.kill();
  return out;
}

/* ── per-guild queue ─────────────────────────────────────────────────────── */
export const queues = new Map();

export class GuildMusic {
  constructor(guild, voiceChannel, textChannel) {
    this.guild = guild;
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;
    this.tracks = [];
    this.current = null;
    this.volume = config.music.defaultVolume;
    this.loop = 'off'; // off | track | queue
    this.playing = false;
    this.connection = null;
    this.player = null;
    this.resource = null;
  }

  static get(guildId) {
    return queues.get(guildId) ?? null;
  }

  static async create(guild, voiceChannel, textChannel) {
    const v = await loadVoice();
    if (!v) throw new Error('Music is unavailable: @discordjs/voice is not installed.');

    const existing = queues.get(guild.id);
    if (existing) {
      existing.textChannel = textChannel;
      if (existing.voiceChannel.id !== voiceChannel.id) {
        existing.voiceChannel = voiceChannel;
        existing.connection?.destroy();
        existing.connection = null;
        await existing.connect();
      }
      return existing;
    }

    const instance = new GuildMusic(guild, voiceChannel, textChannel);
    queues.set(guild.id, instance);
    await instance.connect();
    return instance;
  }

  async connect() {
    const v = await loadVoice();
    this.connection = v.joinVoiceChannel({
      channelId: this.voiceChannel.id,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.player = v.createAudioPlayer({ behaviors: { noSubscriber: v.NoSubscriberBehavior.Play } });
    this.connection.subscribe(this.player);

    this.player.on(v.AudioPlayerStatus.Idle, () => {
      if (this.loop === 'track' && this.current) return this.play(this.current);
      if (this.loop === 'queue' && this.current) this.tracks.push(this.current);
      this.current = null;
      this.playNext();
    });
    this.player.on('error', (err) => {
      console.error('[music] player error:', err.message);
      this.textChannel?.send({ content: `⚠️ Playback error: ${err.message}` }).catch(() => {});
      this.playNext();
    });
    return this.connection;
  }

  async add(tracks) {
    this.tracks.push(...tracks);
    if (!this.current && !this.playing) await this.playNext();
  }

  async playNext() {
    const v = await loadVoice();
    if (!this.tracks.length) {
      this.playing = false;
      this.current = null;
      return;
    }
    const track = this.tracks.shift();
    this.current = track;
    this.playing = true;
    try {
      const pipeline = createAudioStream(track.url, (message) => {
        this.textChannel?.send({ content: message }).catch(() => {});
      });
      this.resource = v.createAudioResource(pipeline.stream, {
        inputType: pipeline.useRaw ? v.StreamType.Raw : v.StreamType.OggOpus,
        inlineVolume: true,
      });
      this.resource.volume?.setVolume(this.volume / 100);
      this.player.play(this.resource);
      this.textChannel?.send({ embeds: [{ color: 0x5865f2, description: `🎶 Now playing **${track.title}** \`${formatDuration(track.duration * 1000)}\`` }] }).catch(() => {});
    } catch (err) {
      console.error('[music] failed to play:', err.message);
      this.textChannel?.send({ content: `⚠️ Could not play **${track.title}**: ${err.message}` }).catch(() => {});
      this.playNext();
    }
  }

  pause() {
    return this.player?.pause();
  }

  resume() {
    return this.player?.unpause();
  }

  skip() {
    const v = this.player;
    if (!v) return null;
    const skipped = this.current;
    this.current = null;
    if (this.loop === 'track') this.loop = 'off';
    v.stop(true);
    return skipped;
  }

  stop() {
    this.tracks = [];
    this.current = null;
    this.loop = 'off';
    this.playing = false;
    this.player?.stop(true);
  }

  shuffle() {
    this.tracks = shuffle(this.tracks);
  }

  setVolume(percent) {
    this.volume = Math.max(1, Math.min(200, percent));
    this.resource?.volume?.setVolume(this.volume / 100);
    return this.volume;
  }

  destroy() {
    try { this.player?.stop(true); } catch { /* noop */ }
    try { this.connection?.destroy(); } catch { /* noop */ }
    queues.delete(this.guild.id);
  }
}

export const formatTrack = (track, index) =>
  `**${index}.** ${track.title} \`${formatDuration(track.duration * 1000)}\` — ${track.requester}`;

export const randomAdvert = () => pick(['🎵', '🎧', '🎶']);
