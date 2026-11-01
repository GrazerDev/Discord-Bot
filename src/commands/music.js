import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import {
  GuildMusic,
  checkBinaries,
  diagnose,
  formatTrack,
  loadVoice,
  resolveTracks,
} from '../lib/music.js';
import { PermissionFlagsBits as P } from 'discord.js';
import { embed, ok, fail, field, C } from '../lib/ui.js';
import { formatDuration, truncate } from '../lib/helpers.js';

const category = 'Music';

/* ── guards ───────────────────────────────────────────────────────────────── */
async function guard(interaction, { needQueue = true, needSameChannel = true } = {}) {
  if (!config.music.enabled) {
    await interaction.editReply({ embeds: [fail('Music is disabled on this instance (`MUSIC_ENABLED=false`).')] });
    return null;
  }
  const v = await loadVoice();
  if (!v) {
    await interaction.editReply({ embeds: [fail('Music dependencies are missing. Run `npm install` again, then restart.')] });
    return null;
  }
  const bins = await checkBinaries();
  if (!bins.ok) {
    await interaction.editReply({
      embeds: [
        fail(
          `Music needs **yt-dlp** and **ffmpeg** on the host.\n\n` +
            `\`\`\`\nyt-dlp: ${bins.ytdlp ? 'ok' : 'missing'}\nffmpeg: ${bins.ffmpeg ? 'ok' : 'missing'}\n\`\`\`\n` +
            'The included Dockerfile installs both. Deploy with Docker rather than a plain buildpack.',
          'Missing binaries',
        ),
      ],
    });
    return null;
  }

  const queue = GuildMusic.get(interaction.guild.id);
  if (needQueue && !queue) {
    await interaction.editReply({ embeds: [fail('Nothing is playing. Use `/play` first.')] });
    return null;
  }
  const voiceChannel = interaction.member.voice?.channel;
  if (needSameChannel && queue && voiceChannel?.id !== queue.voiceChannel.id) {
    await interaction.editReply({ embeds: [fail(`Join ${queue.voiceChannel} to control the player.`)] });
    return null;
  }
  return queue ?? true;
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a song or playlist from a search term or URL')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('query').setDescription('Song name or YouTube URL').setRequired(true).setMaxLength(300)),
    async execute(interaction) {
      if (!(await guard(interaction, { needQueue: false }))) return;
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) return interaction.editReply({ embeds: [fail('Join a voice channel first.')] });

      const perms = voiceChannel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has(['Connect', 'Speak']))
        return interaction.editReply({ embeds: [fail(`I need **Connect** and **Speak** in ${voiceChannel}.`)] });

      const query = interaction.options.getString('query');
      await interaction.editReply({
        embeds: [embed({ description: `🔎 Searching for **${truncate(query, 100)}**…`, color: C.muted, timestamp: false })],
      });

      let tracks;
      try {
        tracks = await resolveTracks(query, `<@${interaction.user.id}>`);
      } catch (err) {
        return interaction.editReply({ embeds: [fail(`Could not load that: ${err.message}`)] });
      }
      if (!tracks.length) return interaction.editReply({ embeds: [fail('No results.')] });

      const queue = await GuildMusic.create(interaction.guild, voiceChannel, interaction.channel);
      await queue.add(tracks);

      const single = tracks.length === 1;
      return interaction.editReply({
        embeds: [
          embed({
            title: single ? '➕ Added to queue' : `➕ Added ${tracks.length} tracks`,
            description: single
              ? formatTrack(tracks[0], 1)
              : tracks.slice(0, 10).map((t, i) => formatTrack(t, i + 1)).join('\n'),
            color: C.ok,
            footer: single ? { text: `Position in queue: ${queue.tracks.length}` } : undefined,
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause or resume playback').setDMPermission(false),
    async execute(interaction) {
      const queue = await guard(interaction);
      if (!queue) return;
      const v = await loadVoice();
      if (queue.player?.state.status === v.AudioPlayerStatus.Paused) {
        queue.resume();
        return interaction.editReply({ embeds: [ok('▶️ Resumed.')] });
      }
      queue.pause();
      return interaction.editReply({ embeds: [ok('⏸️ Paused.')] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track').setDMPermission(false),
    async execute(interaction) {
      const queue = await guard(interaction);
      if (!queue) return;
      const skipped = queue.skip();
      if (!skipped) return interaction.editReply({ embeds: [fail('Nothing is playing.')] });
      return interaction.editReply({ embeds: [ok(`⏭️ Skipped **${truncate(skipped.title, 100)}**.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue').setDMPermission(false),
    async execute(interaction) {
      const queue = await guard(interaction);
      if (!queue) return;
      queue.stop();
      return interaction.editReply({ embeds: [ok('⏹️ Stopped and cleared the queue.')] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current track').setDMPermission(false),
    async execute(interaction) {
      const queue = await guard(interaction);
      if (!queue) return;
      if (!queue.current) return interaction.editReply({ embeds: [fail('Nothing is playing right now.')] });
      const t = queue.current;
      return interaction.editReply({
        embeds: [
          embed({
            title: '🎶 Now playing',
            description: `**[${truncate(t.title, 200)}](${t.url})**`,
            color: C.brand,
            thumbnail: t.thumbnail ?? undefined,
            fields: [
              field('Duration', formatDuration(t.duration * 1000)),
              field('Requested by', t.requester),
              field('Volume', `${queue.volume}%`),
              field('Loop', queue.loop),
              field('Up next', queue.tracks.length ? truncate(queue.tracks[0].title, 80) : 'Nothing'),
            ],
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Show the music queue')
      .setDMPermission(false)
      .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),
    async execute(interaction) {
      const queue = await guard(interaction);
      if (!queue) return;
      const page = (interaction.options.getInteger('page') ?? 1) - 1;
      const perPage = 10;
      const slice = queue.tracks.slice(page * perPage, page * perPage + perPage);
      if (!slice.length) return interaction.editReply({ embeds: [fail('That page is empty.')] });

      const totalTime = queue.tracks.reduce((a, t) => a + t.duration * 1000, 0) + (queue.current?.duration ?? 0) * 1000;
      return interaction.editReply({
        embeds: [
          embed({
            title: `📜 Queue │ ${interaction.guild.name}`,
            color: C.brand,
            description:
              (queue.current ? `**Now:** ${truncate(queue.current.title, 80)}\n\n` : '') +
              slice.map((t, i) => formatTrack(t, page * perPage + i + 1)).join('\n'),
            footer: { text: `${queue.tracks.length} track(s) • ${formatDuration(totalTime)} total • Loop: ${queue.loop}` },
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('player')
      .setDescription('Volume, loop mode, shuffle and queue edits')
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('volume')
          .setDescription('Set the volume')
          .addIntegerOption((o) => o.setName('percent').setDescription('1-200').setRequired(true).setMinValue(1).setMaxValue(200)),
      )
      .addSubcommand((s) =>
        s
          .setName('loop')
          .setDescription('Loop the track or the queue')
          .addStringOption((o) =>
            o
              .setName('mode')
              .setDescription('Loop mode')
              .setRequired(true)
              .addChoices({ name: 'Off', value: 'off' }, { name: 'Track', value: 'track' }, { name: 'Queue', value: 'queue' }),
          ),
      )
      .addSubcommand((s) => s.setName('shuffle').setDescription('Shuffle the queue'))
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a track from the queue')
          .addIntegerOption((o) => o.setName('position').setDescription('Queue position (see /queue)').setRequired(true).setMinValue(1)),
      ),
    async execute(interaction) {
      const queue = await guard(interaction);
      if (!queue) return;
      const sub = interaction.options.getSubcommand();

      if (sub === 'volume') {
        const volume = queue.setVolume(interaction.options.getInteger('percent'));
        return interaction.editReply({ embeds: [ok(`🔊 Volume set to **${volume}%**.`)] });
      }
      if (sub === 'loop') {
        queue.loop = interaction.options.getString('mode');
        return interaction.editReply({ embeds: [ok(`🔁 Loop mode: **${queue.loop}**.`)] });
      }
      if (sub === 'shuffle') {
        if (queue.tracks.length < 2) return interaction.editReply({ embeds: [fail('Not enough tracks to shuffle.')] });
        queue.shuffle();
        return interaction.editReply({ embeds: [ok(`🔀 Shuffled **${queue.tracks.length}** tracks.`)] });
      }
      const position = interaction.options.getInteger('position');
      if (position > queue.tracks.length) return interaction.editReply({ embeds: [fail('There is no track at that position.')] });
      const [removed] = queue.tracks.splice(position - 1, 1);
      return interaction.editReply({ embeds: [ok(`🗑️ Removed **${truncate(removed.title, 100)}**.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('musicdebug')
      .setDescription('Diagnose why music is silent (checks yt-dlp, YouTube access and the audio pipeline)')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false),
    async execute(interaction) {
      await interaction.editReply({ embeds: [embed({ description: 'Running diagnostics — this takes about 10 seconds…', color: C.muted, timestamp: false })] });
      const d = await diagnose();

      const verdict = [];
      if (!d.binaries.ok) verdict.push('❌ yt-dlp or ffmpeg is missing on this host. Deploy with the Dockerfile.');
      else if (d.error && /sign in to confirm|not a bot|cookies|429/i.test(d.error))
        verdict.push('❌ **YouTube is blocking this host’s IP** (bot check). Datacenter IPs like Render’s get challenged. Fix: supply cookies via `--cookies` or run music somewhere with a residential IP.');
      else if (d.error) verdict.push(`❌ ${d.error}`);
      else if (d.bytes === 0) verdict.push('❌ The pipeline produced **zero audio bytes**. yt-dlp could not deliver a stream — almost always the YouTube bot check above, or an age/region restriction.');
      else if (d.bytes < 20000) verdict.push(`⚠️ Only ${d.bytes} bytes arrived — the stream is stalling. Likely CPU starvation (free instances have 0.1 CPU) or a slow network path.`);
      else verdict.push('✅ Audio is flowing. If you still cannot hear it, the player is fine — check that you are not deafened and that the bot’s volume is above 0.');

      const stderr = d.stderr ? [d.stderr.ytdlpErr, d.stderr.ffmpegErr].filter(Boolean).join('\n').trim() : '';

      return interaction.editReply({
        embeds: [
          embed({
            title: '🎧 Music diagnostics',
            color: d.bytes > 20000 ? C.ok : C.error,
            fields: [
              field('Verdict', verdict.join('\n'), false),
              field('yt-dlp', d.version ?? (d.binaries.ytdlp ? 'present' : 'missing')),
              field('ffmpeg', d.binaries.ffmpeg ? 'present' : 'missing'),
              field('Pipeline', d.streamType === 'raw' ? 'PCM + opusscript (CPU heavy)' : 'Ogg Opus (no JS encoding)'),
              field('Test search', d.search ? truncate(d.search, 80) : 'failed'),
              field('Audio bytes in 7s', String(d.bytes)),
              ...(stderr ? [field('Last errors', `\`\`\`\n${truncate(stderr, 700)}\n\`\`\``, false)] : []),
            ],
            footer: { text: 'Fix YouTube blocks with MUSIC_STREAM=raw as a fallback, or supply cookies' },
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('disconnect').setDescription('Disconnect the bot from voice').setDMPermission(false),
    async execute(interaction) {
      const queue = GuildMusic.get(interaction.guild.id);
      if (!queue) return interaction.editReply({ embeds: [fail('I am not in a voice channel.')] });
      queue.destroy();
      return interaction.editReply({ embeds: [ok('👋 Disconnected.')] });
    },
  },
];

export default { category, commands };
