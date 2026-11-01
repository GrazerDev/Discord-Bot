/**
 * Diagnoses "my slash commands don't show up".
 *
 * Worth running before touching anything else, because the answer is almost
 * always one of: never registered, registered to the wrong application, or the
 * bot was invited without the applications.commands scope.
 *
 *   npm run doctor        (or: node scripts/doctor.js)
 *
 * Zero dependencies — it reads .env itself.
 */
import fs from 'node:fs';

const API = 'https://discord.com/api/v10';

/* ── read .env without dotenv ─────────────────────────────────────────────── */
const env = {};
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
}

const TOKEN = env.DISCORD_TOKEN || process.env.DISCORD_TOKEN || '';
const CLIENT_ID = env.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || '';
const GUILD_IDS = (env.GUILD_IDS || process.env.GUILD_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const line = (label, value) => console.log(`  ${label.padEnd(16)}${value}`);
const problems = [];

if (!TOKEN) {
  console.error('\n❌ No DISCORD_TOKEN found in .env or the environment.\n');
  process.exit(1);
}

async function api(path, { auth = true } = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: auth ? { Authorization: `Bot ${TOKEN}` } : {},
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, json, text };
}

console.log('\n═══ Nexus doctor ═══════════════════════════════════════════════');

/* ── 1. is the token valid, and which app owns it? ────────────────────────── */
const me = await api('/users/@me');
if (!me.ok) {
  console.error(`\n❌ Token rejected by Discord (HTTP ${me.status} — ${me.json?.message ?? 'unknown'}).`);
  console.error('   Reset it in the Developer Portal → Bot → Reset Token, then update .env and Render.\n');
  process.exit(1);
}

const app = await api('/applications/@me');
const realAppId = app.json?.id;

console.log('\n── Identity ────────────────────────────────────────────────────');
line('Bot', `${me.json.username}#${me.json.discriminator ?? '0'}  (${me.json.id})`);
line('Real app id', realAppId ?? 'unknown');
line('.env app id', CLIENT_ID || '(missing)');

if (CLIENT_ID && realAppId && CLIENT_ID !== realAppId) {
  line('Match', '❌ MISMATCH');
  problems.push(
    `DISCORD_CLIENT_ID in .env is ${CLIENT_ID} but this token belongs to application ${realAppId}.\n` +
      '     Commands were registered to the WRONG application, so they can never appear.\n' +
      `     Fix: set DISCORD_CLIENT_ID=${realAppId} in .env, then re-run "npm run deploy:commands".`,
  );
} else if (!CLIENT_ID) {
  line('Match', '❌ missing DISCORD_CLIENT_ID');
  problems.push(`Set DISCORD_CLIENT_ID=${realAppId ?? '<application id>'} in .env.`);
} else {
  line('Match', '✅ correct');
}

/* ── 2. what is actually registered? ──────────────────────────────────────── */
const targetApp = CLIENT_ID || realAppId;
const global = await api(`/applications/${targetApp}/commands`);
const globalCount = Array.isArray(global.json) ? global.json.length : 0;

console.log('\n── Registered commands ────────────────────────────────────────');
line('Global', `${globalCount}`);

const guildCounts = {};
for (const guildId of GUILD_IDS) {
  const res = await api(`/applications/${targetApp}/guilds/${guildId}/commands`);
  guildCounts[guildId] = Array.isArray(res.json) ? res.json.length : 0;
  line(`Guild ${guildId}`, `${guildCounts[guildId]}`);
}

if (!GUILD_IDS.length) line('GUILD_IDS', '(empty — global only)');

/* ── 3. which servers is the bot actually in? ─────────────────────────────── */
const guilds = await api('/users/@me/guilds');
const guildList = Array.isArray(guilds.json) ? guilds.json : [];

console.log('\n── Servers the bot is in ──────────────────────────────────────');
if (!guildList.length) {
  line('None', '❌ the bot is not in any server');
  problems.push('Invite the bot: /botinfo → invite, or the OAuth2 URL Generator with the applications.commands scope.');
} else {
  for (const guild of guildList) line(guild.name.slice(0, 24), guild.id);
}

for (const guildId of GUILD_IDS) {
  if (!guildList.some((g) => g.id === guildId)) {
    problems.push(`GUILD_IDS contains ${guildId} but the bot is not in that server — commands registered there are invisible.`);
  }
}

/* ── 4. verdict ───────────────────────────────────────────────────────────── */
console.log('\n── Verdict ────────────────────────────────────────────────────');

const totalGuildCommands = Object.values(guildCounts).reduce((a, b) => a + b, 0);

if (globalCount === 0 && totalGuildCommands === 0) {
  problems.push(
    'No commands are registered anywhere. This is the usual cause: the deploy script has not been run.\n' +
      '     Fix: npm run deploy:commands      (with GUILD_IDS set it is instant, without it takes up to 1 hour)',
  );
}

if (problems.length) {
  console.log('');
  for (const problem of problems) console.log(`  ⚠️  ${problem}`);
  console.log('');
} else {
  console.log('\n  ✅ Commands are registered and the bot is in the server.');
  console.log('\n  If they still do not appear in Discord:');
  console.log('    1. Press Ctrl+R (or Cmd+R) in Discord — the client caches the command list.');
  console.log('    2. Make sure you are in a server channel, not the bot’s DMs.');
  console.log('    3. Check the invite had BOTH scopes: bot + applications.commands.');
  console.log('       If it did not, re-invite the bot with the URL from /botinfo invite.\n');
}
