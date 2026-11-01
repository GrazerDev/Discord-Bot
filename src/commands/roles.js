import { SlashCommandBuilder, PermissionFlagsBits as P } from 'discord.js';
import { db, getGuild, setGuild } from '../db.js';
import { embed, ok, fail, field, C, row, btn, EPH } from '../lib/ui.js';
import { truncate } from '../lib/helpers.js';

const category = 'Roles';

/* Which roles a bot may hand out */
const assignable = (interaction, role) =>
  role &&
  !role.managed &&
  role.position < interaction.guild.members.me.roles.highest.position &&
  (interaction.member.permissions.has(P.Administrator) ||
    role.position < interaction.member.roles.highest.position);

const commands = [
  /* REACTION ROLES ───────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('reactionrole')
      .setDescription('Let members pick roles by reacting to a message')
      .setDefaultMemberPermissions(P.ManageRoles)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Attach a role to an emoji on a message')
          .addStringOption((o) => o.setName('message_id').setDescription('Message ID or link').setRequired(true))
          .addStringOption((o) => o.setName('emoji').setDescription('Emoji to react with').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role to give').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a reaction role')
          .addStringOption((o) => o.setName('message_id').setDescription('Message ID').setRequired(true))
          .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('list')
          .setDescription('List reaction roles')
          .addStringOption((o) => o.setName('message_id').setDescription('Only for this message')),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const parseId = (raw) => raw.match(/\d{17,20}/)?.[0] ?? raw;

      if (sub === 'list') {
        const filter = interaction.options.getString('message_id');
        const rows = filter
          ? db.prepare('SELECT * FROM reaction_roles WHERE guild_id = ? AND message_id = ?').all(interaction.guild.id, parseId(filter))
          : db.prepare('SELECT * FROM reaction_roles WHERE guild_id = ? LIMIT 30').all(interaction.guild.id);
        if (!rows.length) return interaction.editReply({ embeds: [fail('No reaction roles yet.')] });
        return interaction.editReply({
          embeds: [
            embed({
              title: 'Reaction roles',
              color: C.brand,
              description: rows.map((r) => `${r.emoji} → <@&${r.role_id}> on [message](https://discord.com/channels/${interaction.guild.id}/${r.message_id})`).join('\n'),
            }),
          ],
        });
      }

      const messageId = parseId(interaction.options.getString('message_id'));
      const emoji = interaction.options.getString('emoji').trim();

      if (sub === 'remove') {
        const res = db
          .prepare('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?')
          .run(interaction.guild.id, messageId, emoji);
        return interaction.editReply({ embeds: [res.changes ? ok('Reaction role removed.') : fail('Not found.')] });
      }

      const role = interaction.options.getRole('role');
      if (!assignable(interaction, role)) return interaction.editReply({ embeds: [fail('I cannot assign that role — check role positions.')] });

      const channel = interaction.channel;
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) return interaction.editReply({ embeds: [fail('I cannot find that message in this channel.')] });

      const reaction = await message.react(emoji).catch(() => null);
      if (!reaction) return interaction.editReply({ embeds: [fail('That emoji is invalid or I cannot react with it.')] });

      db.prepare('INSERT INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?) ON CONFLICT(message_id, emoji) DO UPDATE SET role_id = excluded.role_id')
        .run(interaction.guild.id, messageId, emoji, role.id);

      return interaction.editReply({ embeds: [ok(`Reacting with ${emoji} now gives ${role}.`)] });
    },
  },

  /* BUTTON ROLE PANELS ──────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('buttonrole')
      .setDescription('Post a self-assign role panel with buttons')
      .setDefaultMemberPermissions(P.ManageRoles)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('create')
          .setDescription('Create a new role panel')
          .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(200))
          .addRoleOption((o) => o.setName('role1').setDescription('First role').setRequired(true))
          .addRoleOption((o) => o.setName('role2').setDescription('Second role'))
          .addRoleOption((o) => o.setName('role3').setDescription('Third role'))
          .addRoleOption((o) => o.setName('role4').setDescription('Fourth role'))
          .addRoleOption((o) => o.setName('role5').setDescription('Fifth role'))
          .addStringOption((o) => o.setName('description').setDescription('Panel description').setMaxLength(1500)),
      )
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a role to an existing panel')
          .addStringOption((o) => o.setName('message_id').setDescription('Panel message ID').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role to add').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a role from a panel')
          .addStringOption((o) => o.setName('message_id').setDescription('Panel message ID').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const parseId = (raw) => raw.match(/\d{17,20}/)?.[0] ?? raw;

      const buildPanel = (messageId, title, description) => {
        const roles = db.prepare('SELECT * FROM button_roles WHERE message_id = ?').all(messageId);
        const buttons = roles.slice(0, 25).map((r) => btn.secondary(`br:${messageId}:${r.role_id}`, r.label, r.emoji ?? undefined));
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) rows.push(row(...buttons.slice(i, i + 5)));
        return {
          embeds: [embed({ title, description: description || 'Click a button to toggle a role.', color: C.brand })],
          components: rows,
        };
      };

      if (sub === 'create') {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description') ?? null;
        const roles = [1, 2, 3, 4, 5].map((n) => interaction.options.getRole(`role${n}`)).filter(Boolean);
        for (const role of roles) if (!assignable(interaction, role)) return interaction.editReply({ embeds: [fail(`I cannot assign ${role}.`)] });

        const message = await interaction.channel.send({
          embeds: [embed({ title, description: description || 'Click a button to toggle a role.', color: C.brand })],
        });
        for (const role of roles) {
          db.prepare('INSERT OR REPLACE INTO button_roles (guild_id, message_id, role_id, label, emoji) VALUES (?, ?, ?, ?, ?)')
            .run(interaction.guild.id, message.id, role.id, truncate(role.name, 78), null);
        }
        await message.edit(buildPanel(message.id, title, description));
        return interaction.editReply({ embeds: [ok(`Panel created with **${roles.length}** role(s).`)] });
      }

      const messageId = parseId(interaction.options.getString('message_id'));
      const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
      if (!message) return interaction.editReply({ embeds: [fail('Panel message not found in this channel.')] });
      const existing = message.embeds[0];

      if (sub === 'add') {
        const role = interaction.options.getRole('role');
        if (!assignable(interaction, role)) return interaction.editReply({ embeds: [fail('I cannot assign that role.')] });
        db.prepare('INSERT OR REPLACE INTO button_roles (guild_id, message_id, role_id, label, emoji) VALUES (?, ?, ?, ?, ?)')
          .run(interaction.guild.id, messageId, role.id, truncate(role.name, 78), null);
      } else {
        const role = interaction.options.getRole('role');
        db.prepare('DELETE FROM button_roles WHERE message_id = ? AND role_id = ?').run(messageId, role.id);
      }

      await message.edit(buildPanel(messageId, existing?.title ?? 'Roles', existing?.description ?? null));
      return interaction.editReply({ embeds: [ok('Panel updated.')] });
    },
  },

  /* VERIFICATION ────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('verifypanel')
      .setDescription('Post a “click to verify” panel that grants a role')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addRoleOption((o) => o.setName('role').setDescription('Role granted on verification').setRequired(true))
      .addStringOption((o) => o.setName('description').setDescription('Panel description').setMaxLength(1000)),
    async execute(interaction) {
      const role = interaction.options.getRole('role');
      if (!assignable(interaction, role)) return interaction.editReply({ embeds: [fail('I cannot assign that role — check its position.')] });
      setGuild(interaction.guild.id, { verify_role: role.id });

      const description =
        interaction.options.getString('description') ??
        'Click the button below to verify and unlock the rest of the server.';
      await interaction.channel.send({
        embeds: [embed({ title: '✅ Verification', description, color: C.ok })],
        components: [row(btn.success('verify:go', 'Verify', '✅'))],
      });
      return interaction.editReply({ embeds: [ok(`Verification panel posted — members will get ${role}.`)] });
    },
  },
];

const components = {
  async br(interaction, args) {
    const [, messageId, roleId] = interaction.customId.split(':');
    const record = db.prepare('SELECT * FROM button_roles WHERE message_id = ? AND role_id = ?').get(messageId, roleId);
    if (!record) return interaction.reply({ embeds: [fail('That role button no longer exists.')], flags: EPH });

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ embeds: [fail('That role was deleted.')], flags: EPH });

    if (interaction.member.roles.cache.has(roleId)) {
      await interaction.member.roles.remove(role, 'Button role toggle').catch(() => {});
      return interaction.reply({ embeds: [ok(`➖ Removed ${role}.`)], flags: EPH });
    }
    await interaction.member.roles.add(role, 'Button role toggle').catch(() => {});
    return interaction.reply({ embeds: [ok(`➕ Added ${role}.`)], flags: EPH });
  },

  async verify(interaction) {
    const settings = getGuild(interaction.guild.id);
    if (!settings.verify_role) return interaction.reply({ embeds: [fail('Verification is not configured.')], flags: EPH });
    const role = interaction.guild.roles.cache.get(settings.verify_role);
    if (!role) return interaction.reply({ embeds: [fail('The verification role was deleted.')], flags: EPH });

    if (interaction.member.roles.cache.has(role.id))
      return interaction.reply({ embeds: [ok('You are already verified.')], flags: EPH });

    await interaction.member.roles.add(role, 'Verified').catch(() => {});
    return interaction.reply({ embeds: [ok(`Welcome! You now have ${role} and full access to the server.`)], flags: EPH });
  },
};

export default { category, commands, components };
