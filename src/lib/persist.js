import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Persistence for hosts with no disk (Render free, etc).
 *
 * The SQLite database is snapshotted to a private GitHub repository every few
 * minutes, and pulled back down at boot if the local file is missing. It is a
 * backup, not a database server: worst case you lose the last few minutes.
 *
 * Requires no paid anything — just a free GitHub repo and a personal access
 * token with "Contents: read and write" on that one repo.
 *
 * All of this is a no-op unless BACKUP_REPO and BACKUP_TOKEN are set.
 */

const API = (process.env.BACKUP_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const REPO = process.env.BACKUP_REPO || '';
const TOKEN = process.env.BACKUP_TOKEN || '';
const FILE = process.env.BACKUP_PATH || 'bot.db';
const BRANCH = process.env.BACKUP_BRANCH || 'main';
const INTERVAL_MIN = Math.max(1, Number(process.env.BACKUP_INTERVAL_MIN || 10));
const MAX_BYTES = 25 * 1024 * 1024; // GitHub starts complaining well before 100 MB

export const persistenceEnabled = Boolean(REPO && TOKEN);

const apiHeaders = () => ({
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'nexus-bot',
});

const contentUrl = () =>
  `${API}/repos/${REPO}/contents/${FILE.split('/').map(encodeURIComponent).join('/')}`;

const dbFile = () => path.resolve(config.dbPath);

function dropSidecars(file) {
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
}

/**
 * Pull the newest snapshot down. Called before the database is opened, so a
 * failed download must never be fatal — we just start with a fresh file.
 */
export async function restoreDatabase() {
  if (!persistenceEnabled) return false;

  const file = dbFile();
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    console.log('[backup] local database found, skipping restore');
    return false;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });

  try {
    const res = await fetch(`${contentUrl()}?ref=${encodeURIComponent(BRANCH)}`, {
      headers: { ...apiHeaders(), Accept: 'application/vnd.github.raw' },
    });

    if (res.status === 404) {
      console.log(`[backup] no snapshot in ${REPO}/${FILE} yet — starting with a fresh database`);
      return false;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(file, buffer);
    dropSidecars(file);
    console.log(`[backup] restored ${(buffer.length / 1024).toFixed(0)} KB from ${REPO}/${FILE}`);
    return true;
  } catch (err) {
    console.warn(`[backup] restore failed (${err.message}) — starting with a fresh database`);
    return false;
  }
}

let inFlight = false;
let snapshots = 0;

/** Write a consistent copy of the database and push it to GitHub. */
export async function snapshot(reason = 'interval') {
  if (!persistenceEnabled || inFlight) return false;

  const file = dbFile();
  if (!fs.existsSync(file)) return false;

  inFlight = true;
  const tmp = path.join('/tmp', `nexus-snapshot-${process.pid}-${Date.now()}.db`);

  try {
    // VACUUM INTO produces a clean, fully-checkpointed copy — no WAL files to
    // worry about, and safe while the bot is actively writing.
    const { db } = await import('../db.js');
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);

    const buffer = fs.readFileSync(tmp);
    if (buffer.length > MAX_BYTES) {
      console.warn(`[backup] database is ${(buffer.length / 1048576).toFixed(1)} MB — skipping (too large to push)`);
      return false;
    }

    // The contents API needs the current blob sha to replace an existing file.
    let sha;
    const meta = await fetch(`${contentUrl()}?ref=${encodeURIComponent(BRANCH)}`, { headers: apiHeaders() });
    if (meta.ok) {
      sha = (await meta.json()).sha;
    } else if (meta.status !== 404) {
      throw new Error(`metadata HTTP ${meta.status}`);
    }

    const put = await fetch(contentUrl(), {
      method: 'PUT',
      headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `snapshot ${new Date().toISOString()} (${reason})`,
        content: buffer.toString('base64'),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!put.ok) throw new Error(`upload HTTP ${put.status} ${(await put.text()).slice(0, 160)}`);

    snapshots += 1;
    console.log(`[backup] snapshot #${snapshots} pushed (${(buffer.length / 1024).toFixed(0)} KB, ${reason})`);
    return true;
  } catch (err) {
    console.warn(`[backup] snapshot failed: ${err.message}`);
    return false;
  } finally {
    fs.rmSync(tmp, { force: true });
    inFlight = false;
  }
}

let timer = null;

export function startPersistence() {
  if (!persistenceEnabled) {
    console.log('[backup] disabled (set BACKUP_REPO + BACKUP_TOKEN to enable free-tier persistence)');
    return false;
  }
  if (timer) clearInterval(timer);
  timer = setInterval(() => snapshot('interval').catch(() => {}), INTERVAL_MIN * 60_000);
  timer.unref?.();
  console.log(`[backup] every ${INTERVAL_MIN} min → ${REPO}/${FILE} (${BRANCH})`);
  return true;
}

export function stopPersistence() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Best-effort final push. Render gives ~30 s after SIGTERM. */
export async function finalSnapshot() {
  if (!persistenceEnabled) return false;
  stopPersistence();
  return snapshot('shutdown');
}
