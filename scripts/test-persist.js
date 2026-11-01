/**
 * Tests the no-disk persistence layer against a fake GitHub API.
 * Proves that a snapshot taken before a container is destroyed can be
 * restored byte-for-byte on the next boot.
 *
 *   node scripts/test-persist.js
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB = process.env.DB_PATH ?? './data/persist-test.db';
const clean = () => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true });
};
fs.mkdirSync(path.dirname(DB), { recursive: true });
clean();

/* ── a very small stand-in for the two GitHub endpoints we use ────────────── */
let store = null;
let puts = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    if (!req.url.includes('/contents/bot.db') || !store) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"message":"Not Found"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(store);
    return;
  }
  if (req.method === 'PUT') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        store = Buffer.from(JSON.parse(body).content, 'base64');
        puts += 1;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end('{}');
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ message: err.message }));
      }
    });
    return;
  }
  res.writeHead(405);
  res.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

process.env.BACKUP_API_BASE = `http://127.0.0.1:${port}`;
process.env.BACKUP_REPO = 'tester/nexus-backup';
process.env.BACKUP_TOKEN = 'ghp_fake_token';
process.env.DB_PATH = DB;

let pass = 0;
const assert = (label, condition) => {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  }
};

console.log('\n─── Snapshot / restore ───────────────────────────────────────────');

const persist = await import('../src/lib/persist.js');
const { db } = await import('../src/db.js');

assert('persistence is enabled by env vars', persist.persistenceEnabled === true);

/* Seed data that must survive the round trip. */
const G = '100000000000000009';
const U = '200000000000000008';
db.prepare('INSERT INTO economy (guild_id, user_id, wallet, bank, daily_streak) VALUES (?,?,?,?,?)').run(G, U, 1234, 500, 7);
db.prepare('INSERT INTO levels (guild_id, user_id, xp, level, messages) VALUES (?,?,?,?,?)').run(G, U, 4321, 9, 88);
db.prepare('INSERT INTO warnings (guild_id, user_id, mod_id, reason, created_at) VALUES (?,?,?,?,?)').run(G, U, '8', 'test warning', Date.now());
db.prepare("INSERT INTO guilds (guild_id, modlog_channel, welcome_message) VALUES (?,?,?) ON CONFLICT(guild_id) DO UPDATE SET modlog_channel=excluded.modlog_channel")
  .run(G, '555', 'Welcome {user}!');
db.prepare('INSERT INTO tags (guild_id, name, content, author_id, created_at) VALUES (?,?,?,?,?)').run(G, 'rules', 'be nice', U, Date.now());

const pushed = await persist.snapshot('test');
assert('snapshot uploaded', pushed === true && puts === 1 && store !== null);
assert('snapshot has a plausible size', store.length > 8192);

/* Simulate the container being destroyed: close, wipe, restore. */
db.close();
clean();
assert('database file is gone', !fs.existsSync(DB));

const restored = await persist.restoreDatabase();
assert('restore reported success', restored === true);
assert('database file is back', fs.existsSync(DB));

const verify = new Database(DB, { readonly: true });
const eco = verify.prepare('SELECT * FROM economy WHERE guild_id = ? AND user_id = ?').get(G, U);
const lvl = verify.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?').get(G, U);
const warn = verify.prepare('SELECT * FROM warnings WHERE guild_id = ?').get(G);
const guild = verify.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(G);
const tag = verify.prepare('SELECT * FROM tags WHERE guild_id = ?').get(G);
verify.close();

assert('economy survived (wallet + bank + streak)', eco?.wallet === 1234 && eco?.bank === 500 && eco?.daily_streak === 7);
assert('levels survived', lvl?.xp === 4321 && lvl?.level === 9);
assert('warnings survived', warn?.reason === 'test warning');
assert('guild settings survived', guild?.modlog_channel === '555');
assert('tags survived', tag?.content === 'be nice');

/* Edge cases */
const second = await persist.restoreDatabase();
assert('restore is skipped when a local database exists', second === false);

// No snapshot on the server and no local file: must start fresh, not crash.
store = null;
clean();
const fresh = await persist.restoreDatabase();
assert('missing snapshot starts a fresh database instead of crashing', fresh === false && !fs.existsSync(DB));

server.close();
clean();

if (process.exitCode) console.error('\n❌ Persistence test failed.\n');
else console.log(`\n✅ Persistence test passed (${pass} assertions).\n`);
