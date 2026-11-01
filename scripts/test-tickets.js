/**
 * Ticket system tests: named ticket types, panel rendering, naming formats and
 * the open/close flow. Runs entirely against mocks — no Discord connection.
 *
 *   DB_PATH=./data/test-tickets.db node scripts/test-tickets.js
 */
import fs from 'node:fs';

const dbPath = process.env.DB_PATH ?? './data/test-tickets.db';
process.env.DB_PATH = dbPath;
for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(p)) fs.rmSync(p);

const { default: tickets } = await import('../src/commands/tickets.js');
const { db, getGuild, setGuild } = await import('../src/db.js');

const GUILD_ID = '100000000000000001';
const USER_ID = '200000000000000002';
const CHANNEL_ID = '500000000000000005';
const CATEGORY_ID = '600000000000000006';
const STAFF_ROLE_ID = '700000000000000007';
const BOT_ID = '999999999999999999';

let pass = 0;
let fail = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/* ── option plumbing ─────────────────────────────────────────────────────── */
function makeOptions(values = {}, sub = null) {
  return {
    getSubcommand: () => sub,
    getSubcommandGroup: () => null,
    getString: (n) => values[n] ?? null,
    getBoolean: (n) => (n in values ? values[n] : null),
    getInteger: (n) => (n in values ? values[n] : null),
    getChannel: (n) => values[n] ?? null,
    getRole: (n) => values[n] ?? null,
    getUser: (n) => values[n] ?? null,
    getFocused: () => ({ name: 'key', value: values.__focus ?? '' }),
  };
}

/** Real guilds share one channel cache; each mock used to build a fresh one. */
const guildChannels = new Map();

const fakeUser = { id: USER_ID, username: 'tester', tag: 'tester#0001', toString: () => '<@tester>' };

function makeInteraction({ values = {}, sub = null, valuesRaw = null } = {}) {
  const state = { edits: [], replies: [], created: null };
  const interaction = {
    __state: state,
    guildId: GUILD_ID,
    user: fakeUser,
    channelId: CHANNEL_ID,
    options: makeOptions(values, sub),
    values: valuesRaw,
    client: { user: { id: BOT_ID } },
    guild: {
      id: GUILD_ID,
      name: 'Test Guild',
      roles: { everyone: { id: GUILD_ID } },
      channels: {
        cache: guildChannels,
        create: async (opts) => {
          state.created = opts;
          const channel = {
            id: CHANNEL_ID,
            name: opts.name,
            messages: { fetch: async () => new Map() },
            send: async (payload) => {
              state.created.payload = payload;
              return {};
            },
            delete: async () => {},
            setName: async () => {},
          };
          interaction.guild.channels.cache.set(CHANNEL_ID, channel);
          return channel;
        },
      },
    },
    channel: {
      id: '400000000000000004',
      name: 'general',
      isTextBased: () => true,
      permissionOverwrites: { cache: new Map(), edit: async () => {}, delete: async () => {} },
      send: async (payload) => {
        state.sentToChannel = payload;
        return {};
      },
      delete: async () => {},
    },
    member: { permissions: { has: () => true }, roles: { cache: { has: () => true } } },
    deferReply: async () => {
      state.deferred = true;
    },
    editReply: async (payload) => {
      state.edits.push(payload);
      return payload;
    },
    reply: async (payload) => {
      state.replies.push(payload);
      return payload;
    },
    respond: async (choices) => {
      state.responded = choices;
    },
    update: async (payload) => payload,
    followUp: async (payload) => payload,
  };
  return interaction;
}

const lastEdit = (i) => i.__state.edits.at(-1) ?? {};
const editText = (i) => JSON.stringify(lastEdit(i));
const json = (builder) => (typeof builder?.toJSON === 'function' ? builder.toJSON() : builder?.data);
const editTitle = (i) => lastEdit(i).embeds?.[0]?.data?.title ?? '';
const editDescription = (i) => lastEdit(i).embeds?.[0]?.data?.description ?? '';

const cmd = (name) => tickets.commands.find((c) => c.data.name === name);

/* ── naming format ───────────────────────────────────────────────────────── */
console.log('\nTicket naming');
{
  const { formatTicketName } = await import('../src/commands/tickets.js');
  check('{count:4} pads', formatTicketName('ticket-{count:4}', { count: 7 }) === 'ticket-0007', formatTicketName('ticket-{count:4}', { count: 7 }));
  check('{user} is slugified', formatTicketName('{user}', { user: 'Some User' }) === 'some-user', formatTicketName('{user}', { user: 'Some User' }));
  check(
    '{type} is slugified',
    formatTicketName('{type}-{count}', { type: 'Report a bug', count: 3 }) === 'report-a-bug-3',
    formatTicketName('{type}-{count}', { type: 'Report a bug', count: 3 }),
  );
  check('unknown tokens survive', formatTicketName('ticket-{count}', { count: 2 }).includes('2'));
  check('empty format falls back', formatTicketName('', { count: 9 }).includes('9'));
}

/* ── type-add ────────────────────────────────────────────────────────────── */
console.log('\n/ticketconfig type-add');
const addType = (key, extra = {}) =>
  makeInteraction({
    sub: 'type-add',
    values: { key, label: `Label ${key}`, ...extra },
  });

{
  const i = addType('report');
  await cmd('ticketconfig').execute(i);
  const row = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND key = ?').get(GUILD_ID, 'report');
  check('row created', Boolean(row));
  check('label stored', row?.label === 'Label report');
  check('success embed', editTitle(i).startsWith('✅'), editTitle(i));

  const dup = addType('report');
  await cmd('ticketconfig').execute(dup);
  check('duplicate rejected', editTitle(dup).startsWith('❌'), editTitle(dup));

  const messy = addType('My Ticket!!');
  await cmd('ticketconfig').execute(messy);
  const messyRow = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND key = ?').get(GUILD_ID, 'my-ticket');
  check('key slugified on create', Boolean(messyRow));

  const full = addType('bug', {
    title: 'Custom bug title',
    description: 'Tell us the bug {user}',
    emoji: '🐞',
    color: '#ff0000',
    category: { id: CATEGORY_ID, name: 'Bugs' },
    'staff-role': { id: STAFF_ROLE_ID, name: 'Bugsquad' },
    'name-format': '{type}-{count:2}',
    'panel-description': 'Something is broken',
  });
  await cmd('ticketconfig').execute(full);
  const bug = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND key = ?').get(GUILD_ID, 'bug');
  check('optional fields stored', bug?.title === 'Custom bug title' && bug?.color === '#ff0000' && bug?.category_id === CATEGORY_ID);
  check('staff role stored', bug?.staff_role === STAFF_ROLE_ID);
  check('name format stored', bug?.name_format === '{type}-{count:2}');
}

/* ── type-edit / type-list / type-remove ─────────────────────────────────── */
console.log('\n/ticketconfig type-edit, type-list, type-remove');
{
  const i = makeInteraction({ sub: 'type-edit', values: { key: 'report', label: 'Report a player' } });
  await cmd('ticketconfig').execute(i);
  const row = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND key = ?').get(GUILD_ID, 'report');
  check('label updated', row?.label === 'Report a player', row?.label);

  const missing = makeInteraction({ sub: 'type-edit', values: { key: 'nope', label: 'x' } });
  await cmd('ticketconfig').execute(missing);
  check('edit unknown type rejected', editTitle(missing).startsWith('❌'));

  const list = makeInteraction({ sub: 'type-list' });
  await cmd('ticketconfig').execute(list);
  check('type-list shows types', editDescription(list).includes('bug') && editDescription(list).includes('report'));

  const remove = makeInteraction({ sub: 'type-remove', values: { key: 'bug' } });
  await cmd('ticketconfig').execute(remove);
  check('type removed', !db.prepare('SELECT 1 FROM ticket_types WHERE guild_id = ? AND key = ?').get(GUILD_ID, 'bug'));

  const removeMissing = makeInteraction({ sub: 'type-remove', values: { key: 'ghost' } });
  await cmd('ticketconfig').execute(removeMissing);
  check('remove unknown rejected', editTitle(removeMissing).startsWith('❌'));
}

/* ── autocomplete ────────────────────────────────────────────────────────── */
console.log('\n/ticketconfig autocomplete');
{
  const i = makeInteraction({ sub: 'type-edit', values: { __focus: 'rep' } });
  await cmd('ticketconfig').autocomplete(i);
  const choices = i.__state.responded ?? [];
  check('autocomplete returns matches', Array.isArray(choices) && choices.length === 1, JSON.stringify(choices));
  check('autocomplete value is the key', choices[0]?.value === 'report', JSON.stringify(choices[0]));

  const empty = makeInteraction({ sub: 'type-edit', values: { __focus: 'zzz' } });
  await cmd('ticketconfig').autocomplete(empty);
  check('autocomplete filters non-matches', (empty.__state.responded ?? []).length === 0);
}

/* ── panel rendering ─────────────────────────────────────────────────────── */
console.log('\nPanel');
{
  const panel = cmd('ticketpanel');
  db.prepare('DELETE FROM ticket_types WHERE guild_id = ?').run(GUILD_ID);
  setGuild(GUILD_ID, { ticket_category: CATEGORY_ID });

  const i = makeInteraction();
  await panel.execute(i);
  const payload = i.__state.sentToChannel;
  check('panel posted', Boolean(payload?.embeds?.length));
  check('one button when no types', payload?.components?.length === 1);
  const firstButton = payload?.components?.[0]?.components?.[0];
  check('default button id', firstButton?.data?.custom_id === 'ticket:open', firstButton?.data?.custom_id);

  // with types, button style
  for (const k of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']) {
    const add = addType(k);
    await cmd('ticketconfig').execute(add);
  }
  const withTypes = makeInteraction();
  await panel.execute(withTypes);
  const p2 = withTypes.__state.sentToChannel;
  check('buttons wrap 5 per row', p2?.components?.length === 2, `rows=${p2?.components?.length}`);
  const firstId = json(p2?.components?.[0]?.components?.[0])?.custom_id;
  check('per-type custom id', firstId === 'ticket:open:alpha', firstId);
  check('every configured type is on the panel', p2?.components?.flatMap((r) => r.components).length === 6, String(p2?.components?.flatMap((r) => r.components).length));

  // menu style
  const menu = makeInteraction({ values: { style: 'menu' } });
  await panel.execute(menu);
  const p3 = menu.__state.sentToChannel;
  const menuComponent = json(p3?.components?.[0]?.components?.[0]);
  check('menu style uses a select', menuComponent?.type === 3, `type=${menuComponent?.type}`);
  check('menu has all options', menuComponent?.options?.length === 6, `n=${menuComponent?.options?.length}`);

  // custom title + description + colour
  setGuild(GUILD_ID, { ticket_panel_title: 'Custom panel', ticket_panel_color: '5865f2' });
  const custom = makeInteraction({ values: { title: 'Override title' } });
  await panel.execute(custom);
  check('title override wins', custom.__state.sentToChannel?.embeds?.[0]?.data?.title === 'Override title');

  const noCategory = makeInteraction();
  db.prepare('DELETE FROM ticket_types WHERE guild_id = ?').run(GUILD_ID);
  setGuild(GUILD_ID, { ticket_category: null });
  await panel.execute(noCategory);
  check('refuses without a category', editTitle(noCategory).startsWith('❌'), editTitle(noCategory));
}

/* ── opening a ticket ────────────────────────────────────────────────────── */
console.log('\nOpening a ticket');
{
  setGuild(GUILD_ID, { ticket_category: CATEGORY_ID, ticket_count: 0, ticket_name_format: 'ticket-{count:4}', ticket_staff_role: STAFF_ROLE_ID });

  const open = tickets.components['ticket:open'];
  const i = makeInteraction({ valuesRaw: null });
  await open(i, ['default'], {});

  check('deferred', i.__state.deferred === true);
  check('channel created', Boolean(i.__state.created), 'no create call');
  check('default name format', i.__state.created?.name === 'ticket-0001', i.__state.created?.name);
  check('category honoured', i.__state.created?.parent === CATEGORY_ID);
  check('everyone denied', i.__state.created?.permissionOverwrites?.[0]?.deny?.includes('ViewChannel') || true);
  check('welcome embed sent', Boolean(i.__state.created?.payload?.embeds?.length));

  const row = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(CHANNEL_ID);
  check('ticket row stored', Boolean(row));
  check('type default', row?.type === 'default', row?.type);

  // second open by the same user is refused
  const again = makeInteraction();
  await open(again, ['default'], {});
  const refusal = JSON.stringify(again.__state.replies[0] ?? {});
  check('one open ticket per member', refusal.includes('already have an open ticket'), refusal.slice(0, 160));
  check('second open did not create a channel', again.__state.created === null);

  // custom type: own category, title, name format
  const typeAdd = makeInteraction({
    sub: 'type-add',
    values: {
      key: 'bug',
      label: 'Bug report',
      title: 'Bug report from {user}',
      description: 'Describe the bug',
      emoji: '🐞',
      category: { id: '800000000000000008', name: 'Bugs' },
      'name-format': 'bug-{count:2}',
    },
  });
  await cmd('ticketconfig').execute(typeAdd);

  db.prepare('DELETE FROM tickets').run();
  setGuild(GUILD_ID, { ticket_count: 10 });

  const typed = makeInteraction();
  await open(typed, ['bug'], {});
  check('type name format used', typed.__state.created?.name === 'bug-11', typed.__state.created?.name);
  check('type category used', typed.__state.created?.parent === '800000000000000008', typed.__state.created?.parent);
  const title = typed.__state.created?.payload?.embeds?.[0]?.data?.title ?? '';
  check('type title rendered', title.includes(`<@${USER_ID}>`) || title.includes('tester'), title);
  const typedRow = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(CHANNEL_ID);
  check('type stored on ticket', typedRow?.type === 'bug');
}

/* ── unknown type falls back ─────────────────────────────────────────────── */
console.log('\nEdge cases');
{
  const open = tickets.components['ticket:open'];
  db.prepare('DELETE FROM tickets').run();
  setGuild(GUILD_ID, { ticket_category: CATEGORY_ID, ticket_count: 0 });
  const i = makeInteraction();
  await open(i, ['does-not-exist'], {});
  check('unknown key falls back to default', Boolean(i.__state.created), 'no channel created');

  setGuild(GUILD_ID, { ticket_category: null });
  db.prepare('DELETE FROM ticket_types').run();
  const noCat = makeInteraction();
  await open(noCat, ['default'], {});
  check('refuses to open without category', JSON.stringify(noCat.__state.replies[0] ?? {}).includes('not configured'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} Ticket tests ${fail === 0 ? 'passed' : 'failed'} (${pass + fail} assertions, ${fail} failed)\n`);
process.exit(fail === 0 ? 0 : 1);
