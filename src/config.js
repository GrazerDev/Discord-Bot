import 'dotenv/config';
import path from 'node:path';

const bool = (v, def = false) =>
  v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(String(v).trim());

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.DISCORD_CLIENT_ID || '',
  guildIds: list(process.env.GUILD_IDS || process.env.GUILD_ID),
  ownerIds: list(process.env.OWNER_IDS),

  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'bot.db'),

  presence: process.env.PRESENCE || '/help • Nexus',
  presenceStatus: process.env.PRESENCE_STATUS || 'online',

  colors: {
    brand: 0x5865f2,
    ok: 0x2ecc71,
    warn: 0xf1c40f,
    error: 0xe74c3c,
    muted: 0x95a5a6,
    star: 0xf7b731,
  },

  music: {
    enabled: bool(process.env.MUSIC_ENABLED, true),
    defaultVolume: Number(process.env.MUSIC_VOLUME || 60),
    maxQueue: Number(process.env.MUSIC_MAX_QUEUE || 200),
    ytdlp: process.env.YTDLP_PATH || 'yt-dlp',
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    // 'ogg' = let ffmpeg produce Opus directly (cheap, no JS encoding).
    // 'raw' = decode to PCM in ffmpeg and encode in JS via opusscript (CPU heavy).
    stream: (process.env.MUSIC_STREAM || 'ogg').toLowerCase(),
  },

  ai: {
    baseUrl: process.env.AI_BASE_URL || '',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  },

  features: {
    levels: bool(process.env.FEATURE_LEVELS, true),
    economy: bool(process.env.FEATURE_ECONOMY, true),
    automod: bool(process.env.FEATURE_AUTOMOD, true),
  },
};

export function assertConfig() {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('DISCORD_CLIENT_ID');
  if (missing.length) {
    console.error(
      `\n❌ Missing required environment variables: ${missing.join(', ')}\n` +
        `   Copy .env.example to .env and fill them in.\n`,
    );
    process.exit(1);
  }
}
