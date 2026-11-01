/**
 * Runtime smoke test — exercises the database layer and the pure helpers
 * without touching Discord. Run with:
 *   DB_PATH=./data/smoke.db node scripts/smoke.js
 */
import fs from 'node:fs';

const dbPath = process.env.DB_PATH ?? './data/smoke.db';
process.env.DB_PATH = dbPath;
if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
for (const suffix of ['-wal', '-shm']) if (fs.existsSync(dbPath + suffix)) fs.rmSync(dbPath + suffix);

const { db, getGuild, setGuild, getAutomod, setAutomod, addCase, getCase, getUserCases,
  getLevelRow, levelFromXp, xpForLevel, schedule, dueTasks, deleteTask, bumpStat } = await import('../src/db.js');
const h = await import('../src/lib/helpers.js');
const { commands, components } = await import('../src/commands/index.js');

let pass = 0;
const assert = (label, condition) => {
  if (condition) {
    pass += 1;
  } else {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  }
};

console.log('\n─── Database ─────────────────────────────────────────────────────');

const guild = getGuild('123456789012345678');
assert('guild row is created on demand', guild && guild.guild_id === '123456789012345678');
assert('defaults are applied', guild.welcome_message.includes('{user}') && guild.xp_min === 15);

setGuild(guild.guild_id, { modlog_channel: '111', welcome_channel: '222', bogus_column: 'nope' });
const updated = getGuild(guild.guild_id);
assert('setGuild writes known columns', updated.modlog_channel === '111' && updated.welcome_channel === '222');
assert('setGuild ignores unknown columns', !('bogus_column' in updated));

const am = getAutomod(guild.guild_id);
assert('automod row defaults', am.enabled === 0 && am.punish === 'delete');
setAutomod(guild.guild_id, { enabled: 1, banned_words: 'foo,bar' });
assert('automod patch works', getAutomod(guild.guild_id).banned_words === 'foo,bar');

const caseId = addCase(guild.guild_id, { type: 'ban', userId: '9', modId: '8', reason: 'testing' });
assert('case insert returns an id', caseId === 1);
assert('case fetch', getCase(guild.guild_id, caseId)?.reason === 'testing');
assert('user cases', getUserCases(guild.guild_id, '9').length === 1);

db.prepare('INSERT INTO warnings (guild_id, user_id, mod_id, reason, created_at) VALUES (?,?,?,?,?)')
  .run(guild.guild_id, '9', '8', 'spam', Date.now());
assert('warnings insert', db.prepare('SELECT COUNT(*) AS n FROM warnings').get().n === 1);

const lvl = getLevelRow(guild.guild_id, '9');
assert('level row created', lvl.xp === 0 && lvl.level === 0);
db.prepare('UPDATE levels SET xp = ? WHERE guild_id = ? AND user_id = ?').run(xpForLevel(0) + xpForLevel(1), guild.guild_id, '9');
assert('level math', levelFromXp(xpForLevel(0) + xpForLevel(1)).level === 2);

db.prepare('INSERT INTO economy (guild_id, user_id, wallet) VALUES (?,?,?)').run(guild.guild_id, '9', 500);
db.prepare('UPDATE economy SET wallet = wallet - 100 WHERE guild_id = ? AND user_id = ?').run(guild.guild_id, '9');
assert('economy wallet math', db.prepare('SELECT wallet FROM economy WHERE user_id = ?').get('9').wallet === 400);

const taskId = schedule('unban', { guildId: guild.guild_id, userId: '9' }, Date.now() - 1);
assert('scheduled task is due', dueTasks().some((t) => t.id === taskId));
deleteTask(taskId);
assert('scheduled task deleted', !dueTasks().some((t) => t.id === taskId));

bumpStat(guild.guild_id, 'messages');
bumpStat(guild.guild_id, 'messages');
assert('stats counter', db.prepare('SELECT messages FROM stats WHERE guild_id = ?').get(guild.guild_id).messages === 2);

for (const table of ['tags', 'reminders', 'giveaways', 'giveaway_entries', 'reaction_roles', 'button_roles',
  'starboard_posts', 'suggestions', 'tickets', 'afk', 'temp_channels', 'poll_votes', 'level_rewards', 'autoresponders']) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  assert(`table "${table}" exists`, Boolean(exists));
}

console.log(`  ✓ ${pass} database assertions`);

console.log('\n─── Helpers ──────────────────────────────────────────────────────');
const before = pass;
assert('parseDuration 1h30m', h.parseDuration('1h30m') === 5_400_000);
assert('parseDuration bare seconds', h.parseDuration('90') === 90_000);
assert('parseDuration rubbish', h.parseDuration('hello') === null);
assert('formatDuration', h.formatDuration(3_725_000) === '1h 2m');
assert('progressBar', h.progressBar(5, 10, 10) === '█████░░░░░');
assert('snowflakeTime is a plausible date', Math.abs(h.snowflakeTime('1180000000000000000') - 1.7e12) < 3e11);
assert('applyPlaceholders', h.applyPlaceholders('hi {username} on {server}', { user: { username: 'bob' }, guild: { name: 'g' } }) === 'hi bob on g');
assert('sanitizeChannelName', h.sanitizeChannelName('Ticket: Bob #1!') === 'ticket-bob-1');
assert('truncate', h.truncate('abcdef', 4) === 'abc…');
assert('shuffle keeps items', h.shuffle([1, 2, 3]).length === 3);
console.log(`  ✓ ${pass - before} helper assertions`);

console.log('\n─── Components ───────────────────────────────────────────────────');
const ids = Object.keys(components);
assert('component handlers registered', ids.length >= 10);
for (const id of ids) assert(`handler "${id}" is a function`, typeof components[id] === 'function');

console.log('\n─── Interaction routing ──────────────────────────────────────────');
const { default: register } = await import('../src/events/interactionCreate.js');
assert('interactionCreate registers a listener', typeof register === 'function');
assert('every command has execute', commands.every((c) => typeof c.execute === 'function'));

if (process.exitCode) {
  console.error('\n❌ Smoke test failed.\n');
} else {
  console.log(`\n✅ Smoke test passed (${pass} assertions).\n`);
}
db.close();
