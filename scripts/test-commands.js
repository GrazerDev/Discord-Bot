/**
 * Runs a selection of commands against a fake interaction so runtime typos are
 * caught without needing a Discord token. Network-backed commands are skipped.
 *
 *   DB_PATH=./data/test-commands.db node scripts/test-commands.js
 */
import fs from 'node:fs';

const dbPath = process.env.DB_PATH ?? './data/test-commands.db';
process.env.DB_PATH = dbPath;
for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(p)) fs.rmSync(p);

const { commandMap, commands } = await import('../src/commands/index.js');
const { db } = await import('../src/db.js');

const GUILD_ID = '100000000000000001';
const USER_ID = '200000000000000002';
const OTHER_ID = '300000000000000003';

/** Minimal stand-in for discord.js Collection (only what commands touch). */
function fakeCollection(items = []) {
  const map = new Map(items);
  return {
    size: map.size,
    get: (k) => map.get(k),
    has: (k) => map.has(k),
    values: () => map.values(),
    first: () => items[0],
    filter: (fn) => fakeCollection(items.filter(fn)),
    map: (fn) => items.map(fn),
    find: (fn) => items.find(fn),
    at: (i) => items.at(i),
  };
}

function makeUser(id = USER_ID, username = 'tester') {
  return {
    id,
    username,
    tag: `${username}#0001`,
    bot: false,
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    bannerURL: () => null,
  };
}

function makeInteraction({ commandName, options = {}, subcommand = null, subcommandGroup = null }) {
  const state = { replies: [], edits: [], deferred: false };
  const user = makeUser();
  const other = makeUser(OTHER_ID, 'other');

  const roster = { [USER_ID]: user, [OTHER_ID]: other };

  const interaction = {
    commandName,
    user,
    guildId: GUILD_ID,
    channelId: '400000000000000004',
    client: {
      commands: commandMap,
      user: { id: '999999999999999999', displayAvatarURL: () => '' },
      guilds: { cache: new Map() },
      channels: { cache: new Map() },
      ws: { ping: 42 },
      uptime: 1000,
      users: { fetch: async () => user },
    },
    guild: {
      id: GUILD_ID,
      name: 'Test Guild',
      memberCount: 5,
      ownerId: USER_ID,
      iconURL: () => null,
      bannerURL: () => null,
      channels: { cache: fakeCollection([]) },
      emojis: { cache: fakeCollection([]) },
      roles: { cache: fakeCollection([]), everyone: { id: GUILD_ID } },
      members: { cache: fakeCollection([]), me: { roles: { highest: { position: 100 } } }, fetch: async () => null },
      icon: null,
      premiumTier: 0,
      premiumSubscriptionCount: 0,
      verificationLevel: 'low',
      createdTimestamp: Date.now(),
      fetchOwner: async () => null,
    },
    channel: { id: '400000000000000004', name: 'general', isTextBased: () => true, messages: { fetch: async () => new Map() }, send: async () => ({}) },
    member: {
      id: USER_ID,
      user,
      roles: { cache: new Map(), highest: { position: 5 } },
      permissions: { has: () => true },
      displayName: 'tester',
    },
    options: {
      getString: (name) => options[name] ?? null,
      getInteger: (name) => (options[name] === undefined ? null : options[name]),
      getBoolean: (name) => (options[name] === undefined ? null : options[name]),
      getUser: (name) => (options[name] === undefined ? null : roster[options[name]] ?? makeUser(options[name], 'other')),
      getMember: (name) => (options[name] === undefined ? null : { id: options[name], roles: { highest: { position: 1 } }, user: makeUser(options[name]) }),
      getChannel: (name) => options[name] ?? null,
      getRole: (name) => options[name] ?? null,
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => subcommandGroup,
      getFocused: () => '',
    },
    reply: async (payload) => {
      state.replies.push(payload);
      return payload;
    },
    editReply: async (payload) => {
      state.edits.push(payload);
      return payload;
    },
    followUp: async (payload) => {
      state.replies.push(payload);
      return payload;
    },
    update: async (payload) => {
      state.edits.push(payload);
      return payload;
    },
    deferReply: async () => {
      state.deferred = true;
    },
    episode: state,
    get deferred() {
      return state.deferred;
    },
    get replied() {
      return state.replies.length > 0;
    },
  };
  return { interaction, state };
}

/** Each entry: [commandName, { options, subcommand }, label] */
const cases = [
  ['ping', {}, 'ping'],
  ['8ball', { options: { question: 'Will this work?' } }, '8ball'],
  ['coinflip', {}, 'coinflip'],
  ['dice', { options: { sides: 20, count: 3 } }, 'dice'],
  ['rps', { options: { choice: 'rock' } }, 'rps'],
  ['choose', { options: { options: 'a, b, c' } }, 'choose'],
  ['ship', { options: { user1: USER_ID, user2: OTHER_ID } }, 'ship'],
  ['roast', { options: { user: OTHER_ID } }, 'roast'],
  ['compliment', { options: { user: OTHER_ID } }, 'compliment'],
  ['rate', { subcommand: 'iq', options: { user: OTHER_ID } }, 'rate iq'],
  ['balance', { subcommand: 'view' }, 'balance view'],
  ['daily', {}, 'daily'],
  ['daily', {}, 'daily again (cooldown path)'],
  ['work', {}, 'work'],
  ['work', {}, 'work again (cooldown path)'],
  ['beg', {}, 'beg'],
  ['gamble', { options: { amount: 10 } }, 'gamble'],
  ['slots', { options: { amount: 10 } }, 'slots'],
  ['ecoboard', {}, 'ecoboard'],
  ['rank', {}, 'rank'],
  ['levelboard', {}, 'levelboard'],
  ['tag', { subcommand: 'create', options: { name: 'rules', content: 'be nice' } }, 'tag create'],
  ['tag', { subcommand: 'get', options: { name: 'rules' } }, 'tag get'],
  ['tag', { subcommand: 'list' }, 'tag list'],
  ['tag', { subcommand: 'info', options: { name: 'rules' } }, 'tag info'],
  ['tag', { subcommand: 'delete', options: { name: 'rules' } }, 'tag delete'],
  ['autoresponder', { subcommand: 'add', options: { trigger: 'hello', response: 'hi there', match: 'contains' } }, 'autoresponder add'],
  ['autoresponder', { subcommand: 'list' }, 'autoresponder list'],
  ['remind', { subcommand: 'set', options: { time: '10m', message: 'drink water' } }, 'remind set'],
  ['remind', { subcommand: 'list' }, 'remind list'],
  ['warnings', { subcommand: 'list', options: { user: OTHER_ID } }, 'warnings list'],
  ['case', { subcommand: 'user', options: { user: OTHER_ID } }, 'case user'],
  ['stats', {}, 'stats'],
  ['help', {}, 'help'],
  ['help', { options: { command: 'balance' } }, 'help <command>'],
  ['serverinfo', {}, 'serverinfo'],
  ['roleinfo', { options: { role: { id: '500000000000000005', name: 'Mod', color: 0, hexColor: '#000000', position: 3, members: new Map(), mentionable: true, hoist: false, managed: false, createdTimestamp: Date.now(), permissions: { toArray: () => ['ManageGuild'] } } } }, 'roleinfo'],
  ['channelinfo', {}, 'channelinfo'],
  ['timestamp', { options: { when: '2h' } }, 'timestamp'],
  ['emojis', {}, 'emojis'],
  ['snipe', { subcommand: 'delete' }, 'snipe (empty)'],
];

let failures = 0;
console.log('\n─── Command execution ────────────────────────────────────────────');

for (const [name, config, label] of cases) {
  const command = commandMap.get(name);
  if (!command) {
    console.error(`  ✗ no command called "${name}"`);
    failures += 1;
    continue;
  }
  const { interaction, state } = makeInteraction({ commandName: name, ...config });
  try {
    await command.execute(interaction);
    if (!state.edits.length && !state.replies.length) {
      console.error(`  ✗ ${label} — produced no reply`);
      failures += 1;
    } else {
      const payload = state.edits.at(-1) ?? state.replies.at(-1);
      const title = payload?.embeds?.[0]?.data?.title ?? payload?.embeds?.[0]?.title;
      const preview = String(title ?? payload?.content ?? '').replace(/\n/g, ' ').slice(0, 70);
      console.log(`  ✓ ${label.padEnd(30)} ${preview}`);
    }
  } catch (err) {
    console.error(`  ✗ ${label} — ${err.message}`);
    failures += 1;
  }
}

/* Second pass: the same commands on a populated database must not throw. */
const { getGuild, addCase } = await import('../src/db.js');
getGuild(GUILD_ID);
addCase(GUILD_ID, { type: 'warn', userId: OTHER_ID, modId: USER_ID, reason: 'spam' });
db.prepare('INSERT INTO levels (guild_id, user_id, xp, level) VALUES (?,?,?,?)').run(GUILD_ID, OTHER_ID, 500, 2);
db.prepare('INSERT INTO economy (guild_id, user_id, wallet, bank) VALUES (?,?,?,?)').run(GUILD_ID, OTHER_ID, 1000, 500);

for (const [name, config, label] of [
  ['case', { subcommand: 'user', options: { user: OTHER_ID } }, 'case user (populated)'],
  ['case', { subcommand: 'view', options: { number: 1 } }, 'case view'],
  ['rank', { options: { user: OTHER_ID } }, 'rank (populated)'],
  ['ecoboard', {}, 'ecoboard (populated)'],
  ['levelboard', {}, 'levelboard (populated)'],
  ['warnings', { subcommand: 'list', options: { user: OTHER_ID } }, 'warnings list (empty)'],
]) {
  const { interaction, state } = makeInteraction({ commandName: name, ...config });
  try {
    await commandMap.get(name).execute(interaction);
    const payload = state.edits.at(-1) ?? state.replies.at(-1);
    const title = payload?.embeds?.[0]?.data?.title ?? payload?.embeds?.[0]?.title;
    const preview = String(title ?? payload?.content ?? '').slice(0, 60);
    console.log(`  ✓ ${label.padEnd(30)} ${preview}`);
  } catch (err) {
    console.error(`  ✗ ${label} — ${err.message}`);
    failures += 1;
  }
}

/* Every command object must at least be constructible as JSON. */
for (const command of commands) command.data.toJSON();

if (failures) {
  console.error(`\n❌ ${failures} command test(s) failed.\n`);
  process.exitCode = 1;
} else {
  console.log(`\n✅ ${cases.length + 6} command executions passed.\n`);
}
db.close();
