import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

/* ────────────────────────────────────────────────────────────────────────────
 * Schema. Every table uses IF NOT EXISTS so restarts are safe.
 * ──────────────────────────────────────────────────────────────────────────── */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS guilds (
  guild_id             TEXT PRIMARY KEY,
  -- logging
  modlog_channel       TEXT,
  msg_log_channel      TEXT,
  member_log_channel   TEXT,
  voice_log_channel    TEXT,
  server_log_channel   TEXT,
  -- greetings
  welcome_channel      TEXT,
  welcome_message      TEXT DEFAULT 'Welcome {user} to **{server}**! You are member **#{count}**.',
  welcome_embed        INTEGER DEFAULT 1,
  goodbye_channel      TEXT,
  goodbye_message      TEXT DEFAULT '**{user}** left the server. We are now at **{count}** members.',
  autorole             TEXT,
  bot_autorole         TEXT,
  -- tickets
  ticket_category      TEXT,
  ticket_log_channel   TEXT,
  ticket_staff_role    TEXT,
  ticket_count         INTEGER DEFAULT 0,
  -- starboard
  starboard_channel    TEXT,
  starboard_emoji      TEXT DEFAULT '⭐',
  starboard_threshold  INTEGER DEFAULT 3,
  -- levels
  levels_enabled       INTEGER DEFAULT 1,
  level_channel        TEXT,
  xp_min               INTEGER DEFAULT 15,
  xp_max               INTEGER DEFAULT 25,
  xp_cooldown          INTEGER DEFAULT 60000,
  -- misc
  suggestions_channel  TEXT,
  tempvc_hub           TEXT,
  tempvc_category      TEXT,
  verify_role          TEXT,
  muted_role           TEXT,
  counting_channel     TEXT,
  muted_channels       TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS automod (
  guild_id           TEXT PRIMARY KEY,
  enabled            INTEGER DEFAULT 0,
  anti_invite        INTEGER DEFAULT 1,
  anti_link          INTEGER DEFAULT 1,
  anti_caps          INTEGER DEFAULT 1,
  anti_spam          INTEGER DEFAULT 1,
  anti_mention       INTEGER DEFAULT 1,
  anti_zalgo         INTEGER DEFAULT 1,
  anti_newline       INTEGER DEFAULT 1,
  caps_percent       INTEGER DEFAULT 70,
  spam_count         INTEGER DEFAULT 5,
  spam_window        INTEGER DEFAULT 5,
  mention_limit      INTEGER DEFAULT 5,
  newline_limit      INTEGER DEFAULT 12,
  banned_words       TEXT DEFAULT '',
  whitelist_roles    TEXT DEFAULT '',
  whitelist_channels TEXT DEFAULT '',
  ignored_bots       INTEGER DEFAULT 1,
  punish             TEXT DEFAULT 'delete',
  log_channel        TEXT
);

CREATE TABLE IF NOT EXISTS warnings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  mod_id     TEXT NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warn_user ON warnings (guild_id, user_id);

CREATE TABLE IF NOT EXISTS cases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  type       TEXT NOT NULL,
  user_id    TEXT,
  mod_id     TEXT,
  reason     TEXT,
  duration   INTEGER,
  active     INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_guild ON cases (guild_id, user_id);

CREATE TABLE IF NOT EXISTS economy (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  wallet     INTEGER DEFAULT 0,
  bank       INTEGER DEFAULT 0,
  last_daily INTEGER DEFAULT 0,
  last_weekly INTEGER DEFAULT 0,
  last_work  INTEGER DEFAULT 0,
  last_beg   INTEGER DEFAULT 0,
  last_rob   INTEGER DEFAULT 0,
  daily_streak INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS levels (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  xp         INTEGER DEFAULT 0,
  level      INTEGER DEFAULT 0,
  messages   INTEGER DEFAULT 0,
  last_xp    INTEGER DEFAULT 0,
  voice_seconds INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS level_rewards (
  guild_id TEXT NOT NULL,
  level    INTEGER NOT NULL,
  role_id  TEXT NOT NULL,
  PRIMARY KEY (guild_id, level)
);

CREATE TABLE IF NOT EXISTS tags (
  guild_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  uses       INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, name)
);

CREATE TABLE IF NOT EXISTS autoresponders (
  guild_id TEXT NOT NULL,
  trigger  TEXT NOT NULL,
  response TEXT NOT NULL,
  match    TEXT DEFAULT 'contains',
  author_id TEXT,
  PRIMARY KEY (guild_id, trigger)
);

CREATE TABLE IF NOT EXISTS reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT,
  channel_id TEXT,
  user_id    TEXT NOT NULL,
  message    TEXT NOT NULL,
  remind_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaways (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  message_id   TEXT NOT NULL,
  prize        TEXT NOT NULL,
  description  TEXT,
  winners      INTEGER DEFAULT 1,
  ends_at      INTEGER NOT NULL,
  ended        INTEGER DEFAULT 0,
  host_id      TEXT NOT NULL,
  req_role     TEXT,
  req_level    INTEGER DEFAULT 0,
  winner_ids   TEXT
);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS reaction_roles (
  guild_id   TEXT NOT NULL,
  message_id TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  role_id    TEXT NOT NULL,
  PRIMARY KEY (message_id, emoji)
);

CREATE TABLE IF NOT EXISTS button_roles (
  guild_id   TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role_id    TEXT NOT NULL,
  label      TEXT NOT NULL,
  emoji      TEXT,
  PRIMARY KEY (message_id, role_id)
);

CREATE TABLE IF NOT EXISTS starboard_posts (
  guild_id     TEXT NOT NULL,
  original_id  TEXT NOT NULL,
  starboard_id TEXT NOT NULL,
  stars        INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, original_id)
);

CREATE TABLE IF NOT EXISTS suggestions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  message_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  content    TEXT NOT NULL,
  status     TEXT DEFAULT 'open',
  upvotes    INTEGER DEFAULT 0,
  downvotes  INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  claimed_by TEXT,
  status     TEXT DEFAULT 'open',
  created_at INTEGER NOT NULL,
  closed_at  INTEGER
);

CREATE TABLE IF NOT EXISTS poll_votes (
  message_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  choice     INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS afk (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  status   TEXT NOT NULL,
  since    INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS temp_channels (
  channel_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  owner_id   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kind    TEXT NOT NULL,
  data    TEXT NOT NULL,
  run_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_run ON scheduled (run_at);

CREATE TABLE IF NOT EXISTS stats (
  guild_id TEXT NOT NULL,
  day      TEXT NOT NULL,
  messages INTEGER DEFAULT 0,
  joins    INTEGER DEFAULT 0,
  leaves   INTEGER DEFAULT 0,
  commands INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, day)
);
`;

/* ────────────────────────────────────────────────────────────────────────────
 * Connection
 * ──────────────────────────────────────────────────────────────────────────── */
const dir = path.dirname(path.resolve(config.dbPath));
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(SCHEMA);

/* ────────────────────────────────────────────────────────────────────────────
 * Guild settings helpers
 * ──────────────────────────────────────────────────────────────────────────── */
const GUILD_COLUMNS = new Set(
  db.prepare('PRAGMA table_info(guilds)').all().map((c) => c.name),
);

export function getGuild(guildId) {
  db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
  return db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId);
}

export function setGuild(guildId, patch) {
  getGuild(guildId);
  const keys = Object.keys(patch).filter((k) => GUILD_COLUMNS.has(k));
  if (!keys.length) return getGuild(guildId);
  const sql = `UPDATE guilds SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE guild_id = ?`;
  db.prepare(sql).run(...keys.map((k) => patch[k]), guildId);
  return getGuild(guildId);
}

export function getAutomod(guildId) {
  db.prepare('INSERT OR IGNORE INTO automod (guild_id) VALUES (?)').run(guildId);
  return db.prepare('SELECT * FROM automod WHERE guild_id = ?').get(guildId);
}

const AUTOMOD_COLUMNS = new Set(
  db.prepare('PRAGMA table_info(automod)').all().map((c) => c.name),
);

export function setAutomod(guildId, patch) {
  getAutomod(guildId);
  const keys = Object.keys(patch).filter((k) => AUTOMOD_COLUMNS.has(k));
  if (!keys.length) return getAutomod(guildId);
  const sql = `UPDATE automod SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE guild_id = ?`;
  db.prepare(sql).run(...keys.map((k) => patch[k]), guildId);
  return getAutomod(guildId);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Mod cases
 * ──────────────────────────────────────────────────────────────────────────── */
export function addCase(guildId, { type, userId, modId, reason, duration = null, active = 1 }) {
  const info = db
    .prepare(
      `INSERT INTO cases (guild_id, type, user_id, mod_id, reason, duration, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, type, userId ?? null, modId ?? null, reason ?? null, duration, active, Date.now());
  return Number(info.lastInsertRowid);
}

export const getCase = (guildId, id) =>
  db.prepare('SELECT * FROM cases WHERE guild_id = ? AND id = ?').get(guildId, id);

export const getUserCases = (guildId, userId, limit = 15) =>
  db
    .prepare('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, userId, limit);

/* ────────────────────────────────────────────────────────────────────────────
 * Levels
 * ──────────────────────────────────────────────────────────────────────────── */
export const xpForLevel = (level) => 5 * level * level + 50 * level + 100;

export function levelFromXp(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return { level, intoLevel: remaining, needed: xpForLevel(level) };
}

export function getLevelRow(guildId, userId) {
  db.prepare('INSERT OR IGNORE INTO levels (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
  return db.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Daily stats
 * ──────────────────────────────────────────────────────────────────────────── */
export function bumpStat(guildId, field) {
  const day = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT OR IGNORE INTO stats (guild_id, day) VALUES (?, ?)').run(guildId, day);
  db.prepare(`UPDATE stats SET ${field} = ${field} + 1 WHERE guild_id = ? AND day = ?`).run(guildId, day);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Scheduled tasks (reminders, tempbans, anything delayed)
 * ──────────────────────────────────────────────────────────────────────────── */
export function schedule(kind, data, runAt) {
  const info = db
    .prepare('INSERT INTO scheduled (kind, data, run_at) VALUES (?, ?, ?)')
    .run(kind, JSON.stringify(data), runAt);
  return Number(info.lastInsertRowid);
}

export const dueTasks = (now = Date.now(), limit = 100) =>
  db.prepare('SELECT * FROM scheduled WHERE run_at <= ? ORDER BY run_at ASC LIMIT ?').all(now, limit);

export const deleteTask = (id) => db.prepare('DELETE FROM scheduled WHERE id = ?').run(id);

export function shutdown() {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
