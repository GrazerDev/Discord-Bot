import {
  SlashCommandBuilder,
  PermissionFlagsBits as P,
  ChannelType,
  AttachmentBuilder,
} from 'discord.js';
import { getGuild, setGuild, db } from '../db.js';
import { embed, ok, fail, field, C, row, btn, selectMenu, EPH } from '../lib/ui.js';
import { truncate, sanitizeChannelName, timestamp } from '../lib/helpers.js';
import { logEvent, modLogEmbed } from '../lib/logs.js';

const category = 'Tickets';

const DEFAULT_NAME_FORMAT = 'ticket-{count:4}';

/** Used when a guild has not created any named ticket types yet. */
const FALLBACK_TYPE = {
  key: 'default',
  label: 'Open a ticket',
  title: null,
  description:
    'Thanks for reaching out!\n\nPlease describe your issue in as much detail as you can — screenshots help.\nA member of staff will be with you shortly.',
  emoji: '🎫',
  color: null,
  category_id: null,
  staff_role: null,
  name_format: null,
  panel_description: null,
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Button/menu emoji must be a real emoji or `:name:id` — anything else throws. */
function safeEmoji(value) {
  if (!value) return undefined;
  const s = String(value).trim();
  if (/^<a?:\w{2,32}:\d{17,20}>$/.test(s)) return s;
  if (s.length <= 8 && /\p{Extended_Pictographic}/u.test(s)) return s;
  return undefined;
}

/** Short slug for type keys — unlike sanitizeChannelName this may return ''. */
const slug = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);

function colorOf(hex) {
  if (!hex) return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  return m ? parseInt(m[1], 16) : null;
}

/** `#aabbcc`, `aabbcc`, `random` or `reset` → number | null | 'random' */
function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (s === 'random') return 'random';
  if (s === 'reset' || s === 'default' || s === 'none') return null;
  return colorOf(s);
}

export function formatTicketName(format, { count = 1, user = 'user', type = 'ticket', key = 'default' } = {}) {
  const out = String(format || DEFAULT_NAME_FORMAT)
    .replace(/\{count:(\d+)\}/g, (_, pad) => String(count).padStart(Number(pad), '0'))
    .replace(/\{count\}/g, String(count))
    .replace(/\{user\}/g, sanitizeChannelName(user))
    .replace(/\{type\}/g, sanitizeChannelName(type))
    .replace(/\{key\}/g, sanitizeChannelName(key));
  const cleaned = sanitizeChannelName(out).slice(0, 90);
  return cleaned || `ticket-${count}`;
}

function renderTemplate(text, ctx = {}) {
  if (!text) return text;
  return String(text)
    .replace(/\{user\}/g, ctx.user ? `<@${ctx.user.id}>` : 'there')
    .replace(/\{username\}/g, ctx.user?.username ?? 'user')
    .replace(/\{server\}/g, ctx.server ?? '')
    .replace(/\{count\}/g, String(ctx.count ?? ''))
    .replace(/\{type\}/g, ctx.type ?? '')
    .replace(/\{id\}/g, String(ctx.id ?? ''));
}

function listTypes(guildId) {
  return db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? ORDER BY position ASC, id ASC').all(guildId);
}

function getType(guildId, key) {
  if (!key || key === 'default') return null;
  return db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND key = ?').get(guildId, key) ?? null;
}

/** Configured type, or the built-in one when `key` is default/unknown. */
function effectiveType(guildId, key) {
  return getType(guildId, key) ?? { ...FALLBACK_TYPE, key: key || 'default' };
}

/* ── panel ───────────────────────────────────────────────────────────────── */

function panelEmbed(settings, types) {
  const title = settings.ticket_panel_title || '🎫 Support tickets';
  const footer = settings.ticket_panel_footer || 'One ticket per member at a time';

  let description = settings.ticket_panel_description;
  if (!description) {
    if (types.length) {
      const lines = types
        .map((t) => `${t.emoji || '🎫'} **${t.label}**${t.panel_description ? ` — ${truncate(t.panel_description, 90)}` : ''}`)
        .join('\n');
      description =
        'Pick the option that fits your situation and a **private channel** will be created for you.\n' +
        'Only you and the staff team can see it.\n\n' + lines;
    } else {
      description =
        'Need help from the staff team?\n\n' +
        '**Click the button below** and a private channel will be created where you can explain your issue.\n' +
        'Only you and the staff can see it.';
    }
  }

  return embed({ title, description, color: colorOf(settings.ticket_panel_color) ?? C.brand, footer: { text: footer } });
}

function panelComponents(settings, types) {
  if (!types.length) return [row(btn.primary('ticket:open', 'Open a ticket', '🎫'))];

  const capped = types.slice(0, 25);

  if ((settings.ticket_panel_style || 'buttons') === 'menu') {
    return [
      selectMenu({
        id: 'ticket:open',
        placeholder: 'Choose a ticket type…',
        max: 1,
        options: capped.map((t) => {
          const option = { label: truncate(t.label, 100), value: t.key };
          if (t.panel_description) option.description = truncate(t.panel_description, 100);
          const emoji = safeEmoji(t.emoji);
          if (emoji) option.emoji = emoji;
          return option;
        }),
      }),
    ];
  }

  const rows = [];
  for (let i = 0; i < capped.length; i += 5) {
    rows.push(
      row(
        ...capped.slice(i, i + 5).map((t) =>
          btn.secondary(`ticket:open:${t.key}`, truncate(t.label, 80), safeEmoji(t.emoji)),
        ),
      ),
    );
  }
  return rows.slice(0, 5);
}

/* ── transcripts ─────────────────────────────────────────────────────────── */

async function transcript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const lines = [...messages.values()]
    .reverse()
    .map((m) => {
      const attachments = m.attachments?.size
        ? ` [attachments: ${m.attachments.map((a) => a.url).join(' ')}]`
        : '';
      const embeds = m.embeds?.length ? ` [${m.embeds.length} embed(s)]` : '';
      return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag} (${m.author.id}): ${m.content}${attachments}${embeds}`;
    });
  const header = `Transcript for #${channel.name}\nCreated: ${timestamp(channel.createdTimestamp, 'F')}\nMessages: ${lines.length}\n\n`;
  return new AttachmentBuilder(Buffer.from(header + lines.join('\n'), 'utf8'), {
    name: `${sanitizeChannelName(channel.name)}-transcript.txt`,
  });
}

/* ── commands ────────────────────────────────────────────────────────────── */

const typeOptionBuilders = (sub, { required = false } = {}) => {
  sub
    .addStringOption((o) =>
      o.setName('label').setDescription('Button text, e.g. "Report a player"').setMaxLength(80).setRequired(required),
    )
    .addStringOption((o) => o.setName('title').setDescription('Embed title inside the new ticket').setMaxLength(200))
    .addStringOption((o) =>
      o.setName('description').setDescription('Welcome message inside the new ticket').setMaxLength(1500),
    )
    .addStringOption((o) => o.setName('emoji').setDescription('Button emoji, e.g. 🚨').setMaxLength(60))
    .addStringOption((o) =>
      o.setName('color').setDescription('Embed colour as hex, e.g. #ff9900 (or "random")').setMaxLength(20),
    )
    .addChannelOption((o) =>
      o
        .setName('category')
        .setDescription('Category this type is created in (default: the global one)')
        .addChannelTypes(ChannelType.GuildCategory),
    )
    .addRoleOption((o) => o.setName('staff-role').setDescription('Role pinged for this type'))
    .addStringOption((o) =>
      o
        .setName('name-format')
        .setDescription('Channel name format — {count} {count:4} {user} {type} {key}')
        .setMaxLength(80),
    )
    .addStringOption((o) =>
      o.setName('panel-description').setDescription('Short line shown next to this type on the panel').setMaxLength(100),
    );
  return sub;
};

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('ticketpanel')
      .setDescription('Post the ticket panel in a channel')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((o) => o.setName('title').setDescription('Override the panel title').setMaxLength(200))
      .addStringOption((o) =>
        o.setName('description').setDescription('Override the panel description').setMaxLength(2000),
      )
      .addStringOption((o) =>
        o
          .setName('style')
          .setDescription('How the options are shown (applies to this panel)')
          .addChoices({ name: 'Buttons', value: 'buttons' }, { name: 'Dropdown menu', value: 'menu' }),
      ),
    async execute(interaction) {
      const settings = getGuild(interaction.guild.id);
      const types = listTypes(interaction.guild.id);

      if (!settings.ticket_category && !types.some((t) => t.category_id))
        return interaction.editReply({
          embeds: [
            fail('Set a category first with `/ticketconfig category`, or give a type its own with `/ticketconfig type-add`.'),
          ],
        });

      const overrides = {};
      const channelOption = interaction.options.getChannel('channel');
      const titleOption = interaction.options.getString('title');
      const descriptionOption = interaction.options.getString('description');
      const styleOption = interaction.options.getString('style');
      if (titleOption) overrides.ticket_panel_title = titleOption;
      if (descriptionOption) overrides.ticket_panel_description = descriptionOption;
      if (styleOption) overrides.ticket_panel_style = styleOption;

      const effective = { ...settings, ...overrides };
      const target = channelOption ?? interaction.channel;

      await target.send({ embeds: [panelEmbed(effective, types)], components: panelComponents(effective, types) });

      return interaction.editReply({
        embeds: [
          ok(
            `Panel posted in ${target}.` +
              (types.length ? `\nTypes on the panel: ${types.map((t) => `\`${t.key}\``).join(', ')}` : '\nNo named types yet — using the single default button. Add some with `/ticketconfig type-add`.'),
          ),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('ticketconfig')
      .setDescription('Configure the ticket system')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      /* ── core settings ── */
      .addSubcommand((s) =>
        s
          .setName('category')
          .setDescription('Default category new tickets are created in')
          .addChannelOption((o) =>
            o.setName('category').setDescription('Category').addChannelTypes(ChannelType.GuildCategory).setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('staff')
          .setDescription('Default role that can see tickets')
          .addRoleOption((o) => o.setName('role').setDescription('Staff role').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('log')
          .setDescription('Channel that receives transcripts')
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('name-format')
          .setDescription('Default channel name format — {count} {count:4} {user} {type} {key}')
          .addStringOption((o) =>
            o.setName('format').setDescription('e.g. ticket-{count:4} or {type}-{user}').setMaxLength(80).setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('panel')
          .setDescription('Customise the panel appearance')
          .addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(200))
          .addStringOption((o) => o.setName('description').setDescription('Panel description').setMaxLength(2000))
          .addStringOption((o) => o.setName('color').setDescription('Hex colour, e.g. #5865f2').setMaxLength(20))
          .addStringOption((o) => o.setName('footer').setDescription('Panel footer text').setMaxLength(200))
          .addStringOption((o) =>
            o
              .setName('style')
              .setDescription('Buttons or a dropdown')
              .addChoices({ name: 'Buttons', value: 'buttons' }, { name: 'Dropdown menu', value: 'menu' }),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('message')
          .setDescription('Welcome / closing messages ({user} {type} {count} {id})')
          .addStringOption((o) => o.setName('open').setDescription('Message shown inside a new ticket').setMaxLength(1500))
          .addStringOption((o) =>
            o.setName('close').setDescription('Message posted when a ticket closes').setMaxLength(1000),
          )
          .addBooleanOption((o) =>
            o.setName('ping-staff').setDescription('Ping the staff role when a ticket opens'),
          )
          .addBooleanOption((o) =>
            o.setName('dm-transcript').setDescription('DM the transcript to the ticket opener'),
          ),
      )
      /* ── ticket types ── */
      .addSubcommand((s) =>
        typeOptionBuilders(
          s
            .setName('type-add')
            .setDescription('Create a named ticket type (own button, title and category)')
            .addStringOption((o) =>
              o
                .setName('key')
                .setDescription('Short id used in the button — e.g. report')
                .setMaxLength(24)
                .setRequired(true),
            ),
          { required: true },
        ),
      )
      .addSubcommand((s) =>
        typeOptionBuilders(
          s
            .setName('type-edit')
            .setDescription('Change an existing ticket type')
            .addStringOption((o) =>
              o.setName('key').setDescription('Type to edit').setMaxLength(24).setRequired(true).setAutocomplete(true),
            ),
        ),
      )
      .addSubcommand((s) =>
        s
          .setName('type-remove')
          .setDescription('Delete a ticket type')
          .addStringOption((o) =>
            o.setName('key').setDescription('Type to delete').setMaxLength(24).setRequired(true).setAutocomplete(true),
          ),
      )
      .addSubcommand((s) => s.setName('type-list').setDescription('List every ticket type'))
      .addSubcommand((s) => s.setName('status').setDescription('Show the current ticket configuration'))
      .addSubcommand((s) => s.setName('reset').setDescription('Wipe all ticket settings and types')),

    async autocomplete(interaction) {
      const focused = interaction.options.getFocused(true);
      const types = listTypes(interaction.guild.id);
      const matches = types
        .filter((t) => t.key.includes(focused.value.toLowerCase()) || t.label.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25)
        .map((t) => ({ name: `${t.key} — ${truncate(t.label, 60)}`, value: t.key }));
      return interaction.respond(matches);
    },

    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;
      let settings = getGuild(guildId);

      /* ── simple single-value settings ── */
      if (sub === 'category') {
        const channel = interaction.options.getChannel('category');
        setGuild(guildId, { ticket_category: channel.id });
        return interaction.editReply({ embeds: [ok(`Tickets will be created under **${channel.name}**.`)] });
      }

      if (sub === 'staff') {
        const role = interaction.options.getRole('role');
        setGuild(guildId, { ticket_staff_role: role.id });
        return interaction.editReply({ embeds: [ok(`Staff role set to ${role}.`)] });
      }

      if (sub === 'log') {
        const channel = interaction.options.getChannel('channel');
        setGuild(guildId, { ticket_log_channel: channel.id });
        return interaction.editReply({ embeds: [ok(`Transcripts will be sent to ${channel}.`)] });
      }

      if (sub === 'name-format') {
        const format = interaction.options.getString('format');
        setGuild(guildId, { ticket_name_format: format });
        return interaction.editReply({
          embeds: [
            ok(
              `New tickets will be named like **${formatTicketName(format, { count: 42, user: 'someuser', type: 'report', key: 'report' })}**.\n` +
                'Tokens: `{count}` `{count:4}` `{user}` `{type}` `{key}`',
            ),
          ],
        });
      }

      if (sub === 'panel') {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const color = interaction.options.getString('color');
        const footer = interaction.options.getString('footer');
        const style = interaction.options.getString('style');

        const patch = {};
        if (title !== null) patch.ticket_panel_title = title;
        if (description !== null) patch.ticket_panel_description = description;
        if (footer !== null) patch.ticket_panel_footer = footer;
        if (style !== null) patch.ticket_panel_style = style;
        if (color !== null) {
          const parsed = parseColor(color);
          if (parsed === null && color.trim().toLowerCase() !== 'reset' && color.trim().toLowerCase() !== 'default')
            return interaction.editReply({ embeds: [fail('Colour must be a hex value like `#5865f2`, or `reset`.')] });
          patch.ticket_panel_color = parsed === 'random' ? String(Math.floor(Math.random() * 0xffffff)) : parsed === null ? null : String(parsed);
        }

        if (!Object.keys(patch).length)
          return interaction.editReply({ embeds: [fail('Give at least one of `title`, `description`, `color`, `footer` or `style`.')] });

        settings = setGuild(guildId, patch);
        return interaction.editReply({
          embeds: [ok('Panel appearance updated. Repost it with `/ticketpanel`.')],
        });
      }

      if (sub === 'message') {
        const open = interaction.options.getString('open');
        const close = interaction.options.getString('close');
        const ping = interaction.options.getBoolean('ping-staff');
        const dm = interaction.options.getBoolean('dm-transcript');

        const patch = {};
        if (open !== null) patch.ticket_open_message = open;
        if (close !== null) patch.ticket_closed_message = close;
        if (ping !== null) patch.ticket_ping_staff = ping ? 1 : 0;
        if (dm !== null) patch.ticket_dm_transcript = dm ? 1 : 0;
        if (!Object.keys(patch).length) return interaction.editReply({ embeds: [fail('Give at least one option.')] });

        settings = setGuild(guildId, patch);
        return interaction.editReply({ embeds: [ok('Ticket messages updated.')] });
      }

      /* ── ticket types ── */
      if (sub === 'type-add') {
        const key = slug(interaction.options.getString('key'));
        if (!key) return interaction.editReply({ embeds: [fail('That key is not usable — use letters, numbers and dashes.')] });
        if (getType(guildId, key))
          return interaction.editReply({ embeds: [fail(`A type called \`${key}\` already exists. Use \`/ticketconfig type-edit\`.`)] });

        const count = listTypes(guildId).length;
        if (count >= 25)
          return interaction.editReply({ embeds: [fail('Discord allows at most 25 buttons/options on one panel.')] });

        db.prepare(
          `INSERT INTO ticket_types
             (guild_id, key, label, title, description, emoji, color, category_id, staff_role, name_format, panel_description, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          guildId,
          key,
          interaction.options.getString('label'),
          interaction.options.getString('title'),
          interaction.options.getString('description'),
          interaction.options.getString('emoji'),
          interaction.options.getString('color'),
          interaction.options.getChannel('category')?.id ?? null,
          interaction.options.getRole('staff-role')?.id ?? null,
          interaction.options.getString('name-format'),
          interaction.options.getString('panel-description'),
          count,
        );

        return interaction.editReply({
          embeds: [
            ok(
              `Created ticket type \`${key}\` — button **${interaction.options.getString('label')}**.\n` +
                'Repost the panel with `/ticketpanel` to show it.',
            ),
          ],
        });
      }

      if (sub === 'type-edit') {
        const key = slug(interaction.options.getString('key'));
        const existing = getType(guildId, key);
        if (!existing) return interaction.editReply({ embeds: [fail(`No ticket type called \`${key}\`. Try \`/ticketconfig type-list\`.`)] });

        const map = {
          label: interaction.options.getString('label'),
          title: interaction.options.getString('title'),
          description: interaction.options.getString('description'),
          emoji: interaction.options.getString('emoji'),
          color: interaction.options.getString('color'),
          name_format: interaction.options.getString('name-format'),
          panel_description: interaction.options.getString('panel-description'),
        };
        const patch = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== null));
        if (interaction.options.getChannel('category')) patch.category_id = interaction.options.getChannel('category').id;
        if (interaction.options.getRole('staff-role')) patch.staff_role = interaction.options.getRole('staff-role').id;
        if (!Object.keys(patch).length) return interaction.editReply({ embeds: [fail('Nothing to change.')] });

        db.prepare(`UPDATE ticket_types SET ${Object.keys(patch).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
          ...Object.values(patch),
          existing.id,
        );
        return interaction.editReply({ embeds: [ok(`Updated ticket type \`${key}\`.`)] });
      }

      if (sub === 'type-remove') {
        const key = slug(interaction.options.getString('key'));
        const existing = getType(guildId, key);
        if (!existing) return interaction.editReply({ embeds: [fail(`No ticket type called \`${key}\`.`)] });
        db.prepare('DELETE FROM ticket_types WHERE id = ?').run(existing.id);
        return interaction.editReply({
          embeds: [ok(`Deleted ticket type \`${key}\`. Repost the panel to update it.`)],
        });
      }

      if (sub === 'type-list') {
        const types = listTypes(guildId);
        if (!types.length)
          return interaction.editReply({
            embeds: [
              embed({
                title: '🎫 Ticket types',
                description:
                  'No named types yet — the panel shows a single **Open a ticket** button.\n\n' +
                  'Create one with `/ticketconfig type-add key:<id> label:<button text>`.',
                color: C.brand,
              }),
            ],
          });

        return interaction.editReply({
          embeds: [
            embed({
              title: `🎫 Ticket types (${types.length})`,
              color: C.brand,
              description: types
                .map((t) => `${t.emoji || '🎫'} \`${t.key}\` — **${t.label}**`)
                .join('\n'),
              fields: types.slice(0, 25).map((t) =>
                field(
                  t.key,
                  [
                    `Label: ${t.label}`,
                    `Title: ${t.title ? truncate(t.title, 60) : '`default`'}`,
                    `Category: ${t.category_id ? `<#${t.category_id}>` : '`global`'}`,
                    `Staff: ${t.staff_role ? `<@&${t.staff_role}>` : '`global`'}`,
                    `Name: \`${t.name_format || settings.ticket_name_format || DEFAULT_NAME_FORMAT}\``,
                  ].join('\n'),
                  false,
                ),
              ),
            }),
          ],
        });
      }

      if (sub === 'reset') {
        db.prepare('DELETE FROM ticket_types WHERE guild_id = ?').run(guildId);
        setGuild(guildId, {
          ticket_category: null,
          ticket_staff_role: null,
          ticket_log_channel: null,
          ticket_panel_title: null,
          ticket_panel_description: null,
          ticket_panel_color: null,
          ticket_panel_style: 'buttons',
          ticket_panel_footer: null,
          ticket_name_format: DEFAULT_NAME_FORMAT,
          ticket_open_message: null,
          ticket_closed_message: null,
          ticket_ping_staff: 1,
          ticket_dm_transcript: 0,
        });
        return interaction.editReply({ embeds: [ok('Ticket configuration and all types were reset.')] });
      }

      /* ── status ── */
      settings = getGuild(guildId);
      const types = listTypes(guildId);
      const open = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND status = ?').get(guildId, 'open');

      return interaction.editReply({
        embeds: [
          embed({
            title: '🎫 Ticket configuration',
            color: C.brand,
            fields: [
              field('Category', settings.ticket_category ? `<#${settings.ticket_category}>` : '`not set`'),
              field('Staff role', settings.ticket_staff_role ? `<@&${settings.ticket_staff_role}>` : '`not set`'),
              field('Transcript log', settings.ticket_log_channel ? `<#${settings.ticket_log_channel}>` : '`not set`'),
              field('Name format', `\`${settings.ticket_name_format || DEFAULT_NAME_FORMAT}\``),
              field('Panel style', `\`${settings.ticket_panel_style || 'buttons'}\``),
              field('Ping staff', settings.ticket_ping_staff ? 'yes' : 'no'),
              field('DM transcript', settings.ticket_dm_transcript ? 'yes' : 'no'),
              field('Types', types.length ? types.map((t) => `\`${t.key}\``).join(', ') : '`none (default button)`'),
              field('Tickets opened', String(settings.ticket_count ?? 0)),
              field('Currently open', String(open?.c ?? 0)),
            ],
          }),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Manage the ticket you are in')
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a member to this ticket')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a member from this ticket')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('rename')
          .setDescription('Rename this ticket channel')
          .addStringOption((o) => o.setName('name').setDescription('New channel name').setMaxLength(90).setRequired(true)),
      )
      .addSubcommand((s) => s.setName('close').setDescription('Close this ticket')),

    async execute(interaction) {
      const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(interaction.channel.id);
      if (!ticket) return interaction.editReply({ embeds: [fail('This channel is not a ticket.')] });

      const sub = interaction.options.getSubcommand();

      if (sub === 'close') return closeTicket(interaction, ticket, interaction.user);

      if (sub === 'rename') {
        const isStaff = interaction.member.permissions.has(P.ManageChannels);
        if (interaction.user.id !== ticket.user_id && !isStaff)
          return interaction.editReply({ embeds: [fail('Only the ticket owner or staff can rename this.')] });
        const name = sanitizeChannelName(interaction.options.getString('name')).slice(0, 90);
        if (!name) return interaction.editReply({ embeds: [fail('That name is not usable.')] });
        await interaction.channel.setName(name, `Renamed by ${interaction.user.tag}`);
        return interaction.editReply({ embeds: [ok(`Renamed to **${name}**.`)] });
      }

      const user = interaction.options.getUser('user');
      if (sub === 'add') {
        await interaction.channel.permissionOverwrites.edit(user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
        });
        return interaction.editReply({ embeds: [ok(`${user} was added to this ticket.`)] });
      }

      const overwrite = interaction.channel.permissionOverwrites.cache.get(user.id);
      if (!overwrite) return interaction.editReply({ embeds: [fail(`${user} is not in this ticket.`)] });
      await interaction.channel.permissionOverwrites.delete(user.id);
      return interaction.editReply({ embeds: [ok(`${user} was removed from this ticket.`)] });
    },
  },
];

/* ── shared close logic ──────────────────────────────────────────────────── */

async function closeTicket(interaction, ticket, closer) {
  const settings = getGuild(ticket.guild_id);
  const closingMessage =
    renderTemplate(settings.ticket_closed_message, { user: closer, server: interaction.guild?.name, id: ticket.id }) ||
    '🔒 Closing this ticket in 5 seconds…';

  await interaction.editReply({ embeds: [embed({ description: closingMessage, color: C.warn })] });

  let file = null;
  if (settings.ticket_log_channel || settings.ticket_dm_transcript) {
    file = await transcript(interaction.channel).catch(() => null);
  }

  if (settings.ticket_log_channel && file) {
    const channel = interaction.guild.channels.cache.get(settings.ticket_log_channel);
    if (channel?.isTextBased()) {
      await channel
        .send({
          embeds: [
            embed({
              title: '🎫 Ticket closed',
              color: C.muted,
              fields: [
                field('Ticket', `#${ticket.id}`),
                field('Type', ticket.type || 'default'),
                field('Opened by', `<@${ticket.user_id}>`),
                field('Closed by', `<@${closer.id}>`),
                field('Opened', timestamp(ticket.created_at, 'R'), false),
              ],
            }),
          ],
          files: [file],
        })
        .catch(() => {});
    }
  }

  if (settings.ticket_dm_transcript && file) {
    const opener = await interaction.client.users.fetch(ticket.user_id).catch(() => null);
    if (opener)
      await opener
        .send({
          embeds: [
            embed({
              description: `Your ticket **#${ticket.id}** in **${interaction.guild?.name ?? 'the server'}** was closed by ${closer}. Here is your transcript.`,
              color: C.brand,
            }),
          ],
          files: [file],
        })
        .catch(() => {});
  }

  db.prepare('UPDATE tickets SET status = ?, closed_at = ? WHERE id = ?').run('closed', Date.now(), ticket.id);
  await logEvent(
    interaction.guild,
    'modlog_channel',
    modLogEmbed({ title: 'Ticket closed', description: `#${ticket.id} closed by ${closer.tag}`, color: C.muted }),
  );
  setTimeout(() => interaction.channel.delete(`Ticket #${ticket.id} closed`).catch(() => {}), 5000);
}

/* ── components ──────────────────────────────────────────────────────────── */

const components = {
  async 'ticket:open'(interaction, args = []) {
    const fromMenu =
      typeof interaction.isStringSelectMenu === 'function'
        ? interaction.isStringSelectMenu()
        : Array.isArray(interaction.values);
    const key = slug(fromMenu ? interaction.values?.[0] : args[0]) || 'default';

    const settings = getGuild(interaction.guild.id);
    const type = effectiveType(interaction.guild.id, key);
    const categoryId = type.category_id || settings.ticket_category;

    if (!categoryId)
      return interaction.reply({
        embeds: [fail('Tickets are not configured yet. An admin needs to run `/ticketconfig category`.')],
        flags: EPH,
      });

    const existing = db
      .prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = ?')
      .get(interaction.guild.id, interaction.user.id, 'open');
    if (existing && interaction.guild.channels.cache.has(existing.channel_id))
      return interaction.reply({
        embeds: [fail(`You already have an open ticket: <#${existing.channel_id}>`)],
        flags: EPH,
      });

    await interaction.deferReply({ flags: EPH });

    const staffRole = type.staff_role || settings.ticket_staff_role;

    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [P.ViewChannel], type: 0 },
      {
        id: interaction.user.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles],
        type: 1,
      },
      {
        id: interaction.client.user.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.AttachFiles],
        type: 1,
      },
    ];
    if (staffRole)
      overwrites.push({
        id: staffRole,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles],
        type: 0,
      });

    const count = (settings.ticket_count ?? 0) + 1;
    setGuild(interaction.guild.id, { ticket_count: count });

    const name = formatTicketName(type.name_format || settings.ticket_name_format || DEFAULT_NAME_FORMAT, {
      count,
      user: interaction.user.username,
      type: type.label,
      key: type.key,
    });

    const channel = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `Ticket #${count} • ${type.label} • ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: overwrites,
    });

    db.prepare('INSERT INTO tickets (guild_id, channel_id, user_id, created_at, type) VALUES (?, ?, ?, ?, ?)').run(
      interaction.guild.id,
      channel.id,
      interaction.user.id,
      Date.now(),
      type.key,
    );
    const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channel.id);

    const ctx = {
      user: interaction.user,
      server: interaction.guild.name,
      count,
      type: type.label,
      id: ticket.id,
    };

    const title = type.title ? renderTemplate(type.title, ctx) : `🎫 ${type.label}`;
    const description =
      renderTemplate(type.description || settings.ticket_open_message, ctx) || FALLBACK_TYPE.description;

    const ping = (settings.ticket_ping_staff ?? 1) && staffRole ? ` <@&${staffRole}>` : '';

    await channel
      .send({
        content: `<@${interaction.user.id}>${ping}`,
        embeds: [
          embed({
            title: truncate(title, 256),
            description: truncate(description, 4000),
            color: colorOf(type.color) ?? C.ok,
            footer: { text: `Ticket #${ticket.id} • ${type.key}` },
          }),
        ],
        components: [
          row(
            btn.success('ticket:claim', 'Claim', '🙋'),
            btn.danger('ticket:close', 'Close', '🔒'),
          ),
        ],
      })
      .catch(() => {});

    return interaction.editReply({ embeds: [ok(`Your ticket is ready: ${channel}`)] });
  },

  async 'ticket:close'(interaction) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(interaction.channel.id);
    if (!ticket) return interaction.reply({ embeds: [fail('This is not a ticket channel.')], flags: EPH });
    if (interaction.user.id !== ticket.user_id && !interaction.member.permissions.has(P.ManageChannels))
      return interaction.reply({ embeds: [fail('Only the ticket owner or staff can close this.')], flags: EPH });

    return closeTicket(interaction, ticket, interaction.user);
  },

  async 'ticket:claim'(interaction) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(interaction.channel.id);
    if (!ticket) return interaction.reply({ embeds: [fail('This is not a ticket channel.')], flags: EPH });

    const settings = getGuild(interaction.guild.id);
    const staffRole = settings.ticket_staff_role;
    const isStaff =
      interaction.member.permissions.has(P.ManageChannels) || (staffRole && interaction.member.roles.cache.has(staffRole));
    if (!isStaff) return interaction.reply({ embeds: [fail('Only staff can claim tickets.')], flags: EPH });

    db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run(interaction.user.id, ticket.id);
    return interaction.reply({ embeds: [ok(`🙋 ${interaction.user} claimed this ticket.`)] });
  },
};

export default { category, commands, components };
