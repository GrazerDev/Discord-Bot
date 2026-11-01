import {
  SlashCommandBuilder,
  PermissionFlagsBits as P,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { addCase, getUserCases, getCase, db, schedule } from '../db.js';
import {
  parseDuration,
  formatDuration,
  hierarchyProblem,
  timestamp,
  truncate,
} from '../lib/helpers.js';
import { embed, ok, fail, field, C, row, btn, EPH } from '../lib/ui.js';
import { logEvent, modLogEmbed } from '../lib/logs.js';
import { registerTask } from '../lib/scheduler.js';

const category = 'Moderation';

/* ── shared helpers ───────────────────────────────────────────────────────── */
async function notify(member, text) {
  if (!member || member.user.bot) return;
  await member.send({ embeds: [embed({ description: text, color: C.error })] }).catch(() => {});
}

async function record(interaction, type, target, reason, duration = null) {
  const caseId = addCase(interaction.guild.id, {
    type,
    userId: target.id,
    modId: interaction.user.id,
    reason,
    duration,
  });
  return caseId;
}

async function modLog(interaction, caseId, type, target, reason, duration) {
  await logEvent(
    interaction.guild,
    'modlog_channel',
    modLogEmbed({
      title: `${type.toUpperCase()} │ Case #${caseId}`,
      color: C.error,
      fields: [
        { name: 'User', value: `${target.tag ?? target.user?.tag} (\`${target.id}\`)`, inline: true },
        { name: 'Moderator', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
        ...(duration ? [{ name: 'Duration', value: formatDuration(duration), inline: true }] : []),
        { name: 'Reason', value: reason || 'No reason provided' },
      ],
    }),
  );
}

const reasonOption = (o) =>
  o.setName('reason').setDescription('Reason for this action').setMaxLength(400);

/* ── commands ─────────────────────────────────────────────────────────────── */
const commands = [
  /* BAN ─────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member from the server')
      .setDefaultMemberPermissions(P.BanMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
      .addStringOption((o) => reasonOption(o.setDescription('Reason')))
      .addIntegerOption((o) =>
        o
          .setName('delete_messages')
          .setDescription('Delete this many days of their messages (0-7)')
          .setMinValue(0)
          .setMaxValue(7),
      )
      .addStringOption((o) =>
        o.setName('duration').setDescription('Temporary ban, e.g. 1d, 12h (optional)'),
      ),
    async execute(interaction) {
      const target = interaction.options.getMember('user');
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      const days = interaction.options.getInteger('delete_messages') ?? 0;
      const rawDuration = interaction.options.getString('duration');
      const duration = rawDuration ? parseDuration(rawDuration) : null;

      const problem = hierarchyProblem(interaction.member, target, interaction.guild.members.me);
      if (target && problem) return interaction.editReply({ embeds: [fail(problem)] });

      const caseId = await record(interaction, 'ban', user, reason, duration);
      await interaction.guild.members.ban(user.id, {
        deleteMessageSeconds: days * 86400,
        reason: `${interaction.user.tag}: ${reason}`,
      });
      await notify(target, `You were **banned** from **${interaction.guild.name}**.\nReason: ${reason}${duration ? `\nDuration: ${formatDuration(duration)}` : ''}`);

      if (duration) {
        schedule('unban', { guildId: interaction.guild.id, userId: user.id, caseId }, Date.now() + duration);
      }
      await modLog(interaction, caseId, 'ban', user, reason, duration);

      return interaction.editReply({
        embeds: [
          ok(
            `**${user.tag}** was banned.${duration ? ` It expires ${timestamp(Date.now() + duration)}.` : ''}\n> ${reason}`,
            `Case #${caseId}`,
          ).setFooter({ text: `Case #${caseId} • ${reason}` }),
        ],
      });
    },
  },

  /* UNBAN ────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user by ID')
      .setDefaultMemberPermissions(P.BanMembers)
      .setDMPermission(false)
      .addStringOption((o) => o.setName('user_id').setDescription('The user ID to unban').setRequired(true))
      .addStringOption((o) => reasonOption(o.setDescription('Reason'))),
    async execute(interaction) {
      const userId = interaction.options.getString('user_id').trim();
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      if (!/^\d{17,20}$/.test(userId)) return interaction.editReply({ embeds: [fail('That is not a valid user ID.')] });

      const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
      if (!ban) return interaction.editReply({ embeds: [fail('That user is not banned.')] });

      await interaction.guild.bans.remove(userId, `${interaction.user.tag}: ${reason}`);
      const caseId = addCase(interaction.guild.id, {
        type: 'unban',
        userId,
        modId: interaction.user.id,
        reason,
      });
      await modLog(interaction, caseId, 'unban', ban.user, reason);
      return interaction.editReply({ embeds: [ok(`**${ban.user.tag}** was unbanned.\n> ${reason}`, `Case #${caseId}`)] });
    },
  },

  /* SOFTBAN ──────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('softban')
      .setDescription('Ban then immediately unban a member (deletes their messages)')
      .setDefaultMemberPermissions(P.BanMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member to softban').setRequired(true))
      .addStringOption((o) => reasonOption(o.setDescription('Reason'))),
    async execute(interaction) {
      const target = interaction.options.getMember('user');
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      const problem = hierarchyProblem(interaction.member, target, interaction.guild.members.me);
      if (target && problem) return interaction.editReply({ embeds: [fail(problem)] });

      await interaction.guild.members.ban(user.id, {
        deleteMessageSeconds: 604800,
        reason: `softban by ${interaction.user.tag}: ${reason}`,
      });
      await interaction.guild.bans.remove(user.id, 'softban');
      const caseId = addCase(interaction.guild.id, { type: 'softban', userId: user.id, modId: interaction.user.id, reason });
      await modLog(interaction, caseId, 'softban', user, reason);
      return interaction.editReply({ embeds: [ok(`**${user.tag}** was softbanned and their recent messages were removed.`, `Case #${caseId}`)] });
    },
  },

  /* KICK ─────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server')
      .setDefaultMemberPermissions(P.KickMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
      .addStringOption((o) => reasonOption(o.setDescription('Reason'))),
    async execute(interaction) {
      const target = interaction.options.getMember('user');
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      const problem = hierarchyProblem(interaction.member, target, interaction.guild.members.me);
      if (target && problem) return interaction.editReply({ embeds: [fail(problem)] });

      await notify(target, `You were **kicked** from **${interaction.guild.name}**.\nReason: ${reason}`);
      await target.kick(`${interaction.user.tag}: ${reason}`);
      const caseId = addCase(interaction.guild.id, { type: 'kick', userId: user.id, modId: interaction.user.id, reason });
      await modLog(interaction, caseId, 'kick', user, reason);
      return interaction.editReply({ embeds: [ok(`**${user.tag}** was kicked.\n> ${reason}`, `Case #${caseId}`)] });
    },
  },

  /* TIMEOUT ──────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Time a member out (max 28 days)')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member to time out').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true))
      .addStringOption((o) => reasonOption(o.setDescription('Reason'))),
    async execute(interaction) {
      const target = interaction.options.getMember('user');
      const user = interaction.options.getUser('user');
      const duration = parseDuration(interaction.options.getString('duration'));
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      if (!duration || duration < 1000 || duration > 28 * 86400000)
        return interaction.editReply({ embeds: [fail('Duration must be between 1 second and 28 days, e.g. `10m`, `2h`, `3d`.')] });

      const problem = hierarchyProblem(interaction.member, target, interaction.guild.members.me);
      if (target && problem) return interaction.editReply({ embeds: [fail(problem)] });

      await target.timeout(duration, `${interaction.user.tag}: ${reason}`);
      await notify(target, `You were **timed out** in **${interaction.guild.name}** for ${formatDuration(duration)}.\nReason: ${reason}`);
      const caseId = addCase(interaction.guild.id, {
        type: 'timeout',
        userId: user.id,
        modId: interaction.user.id,
        reason,
        duration,
        active: 1,
      });
      await modLog(interaction, caseId, 'timeout', user, reason, duration);
      return interaction.editReply({ embeds: [ok(`**${user.tag}** was timed out for **${formatDuration(duration)}** (ends ${timestamp(Date.now() + duration)}).\n> ${reason}`, `Case #${caseId}`)] });
    },
  },

  /* UNTIMEOUT ────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('untimeout')
      .setDescription('Remove a timeout from a member')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => reasonOption(o.setDescription('Reason'))),
    async execute(interaction) {
      const target = interaction.options.getMember('user');
      if (!target) return interaction.editReply({ embeds: [fail('That member is not in this server.')] });
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      if (!target.communicationDisabledUntil) return interaction.editReply({ embeds: [fail('That member is not timed out.')] });

      await target.timeout(null, `${interaction.user.tag}: ${reason}`);
      const caseId = addCase(interaction.guild.id, { type: 'untimeout', userId: target.id, modId: interaction.user.id, reason });
      await modLog(interaction, caseId, 'untimeout', target.user, reason);
      return interaction.editReply({ embeds: [ok(`Timeout removed from **${target.user.tag}**.`, `Case #${caseId}`)] });
    },
  },

  /* WARN ─────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(400)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const target = interaction.options.getMember('user');

      const info = db
        .prepare('INSERT INTO warnings (guild_id, user_id, mod_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(interaction.guild.id, user.id, interaction.user.id, reason, Date.now());
      const { total } = db
        .prepare('SELECT COUNT(*) AS total FROM warnings WHERE guild_id = ? AND user_id = ?')
        .get(interaction.guild.id, user.id);

      await notify(target, `You were **warned** in **${interaction.guild.name}**.\nReason: ${reason}\nTotal warnings: ${total}`);
      const caseId = addCase(interaction.guild.id, { type: 'warn', userId: user.id, modId: interaction.user.id, reason });
      await modLog(interaction, caseId, 'warn', user, reason);

      return interaction.editReply({
        embeds: [ok(`**${user.tag}** was warned. They now have **${total}** warning(s).\n> ${reason}`, `Warning #${info.lastInsertRowid} • Case #${caseId}`)],
      });
    },
  },

  /* WARNINGS ────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('List, delete or clear warnings')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s.setName('list').setDescription('List warnings for a member')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      )
      .addSubcommand((s) =>
        s.setName('delete').setDescription('Delete one warning by ID')
          .addIntegerOption((o) => o.setName('id').setDescription('Warning ID').setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) =>
        s.setName('clear').setDescription('Clear every warning for a member')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'delete') {
        const id = interaction.options.getInteger('id');
        const res = db.prepare('DELETE FROM warnings WHERE id = ? AND guild_id = ?').run(id, interaction.guild.id);
        return interaction.editReply({ embeds: [res.changes ? ok(`Deleted warning #${id}.`) : fail(`No warning with ID ${id}.`)] });
      }

      const user = interaction.options.getUser('user');
      if (sub === 'clear') {
        const res = db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?').run(interaction.guild.id, user.id);
        return interaction.editReply({ embeds: [ok(`Cleared **${res.changes}** warning(s) for **${user.tag}**.`)] });
      }

      const rows = db
        .prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 25')
        .all(interaction.guild.id, user.id);
      if (!rows.length) return interaction.editReply({ embeds: [ok(`**${user.tag}** has no warnings.`)] });
      return interaction.editReply({
        embeds: [
          embed({
            title: `Warnings for ${user.tag} (${rows.length})`,
            color: C.warn,
            description: rows.map((w) => `**#${w.id}** ${timestamp(w.created_at, 'd')} by <@${w.mod_id}>\n> ${truncate(w.reason, 200)}`).join('\n'),
          }),
        ],
      });
    },
  },

  /* CASES ───────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('case')
      .setDescription('Moderation history')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s.setName('user').setDescription('All cases for a member')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      )
      .addSubcommand((s) =>
        s.setName('view').setDescription('Inspect one case')
          .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1)),
      ),
    async execute(interaction) {
      if (interaction.options.getSubcommand() === 'view') {
        const row = getCase(interaction.guild.id, interaction.options.getInteger('number'));
        if (!row) return interaction.editReply({ embeds: [fail('Case not found.')] });
        return interaction.editReply({
          embeds: [
            embed({
              title: `Case #${row.id} │ ${row.type}`,
              color: C.brand,
              fields: [
                field('User', row.user_id ? `<@${row.user_id}> (\`${row.user_id}\`)` : '—'),
                field('Moderator', row.mod_id ? `<@${row.mod_id}>` : '—'),
                field('Created', timestamp(row.created_at, 'F'), false),
                field('Duration', row.duration ? formatDuration(row.duration) : 'Permanent'),
                field('Reason', row.reason || 'None', false),
              ],
            }),
          ],
        });
      }

      const user = interaction.options.getUser('user');
      const rows = getUserCases(interaction.guild.id, user.id, 20);
      if (!rows.length) return interaction.editReply({ embeds: [fail(`No cases for **${user.tag}**.`)] });
      return interaction.editReply({
        embeds: [
          embed({
            title: `Case history │ ${user.tag}`,
            color: C.brand,
            description: rows
              .map((c) => `**#${c.id}** \`${c.type}\` ${timestamp(c.created_at, 'R')} by <@${c.mod_id}>\n> ${truncate(c.reason, 150)}`)
              .join('\n'),
          }),
        ],
      });
    },
  },

  /* PURGE ────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Bulk delete messages in this channel')
      .setDefaultMemberPermissions(P.ManageMessages)
      .setDMPermission(false)
      .addIntegerOption((o) =>
        o.setName('amount').setDescription('How many messages (1-1000)').setRequired(true).setMinValue(1).setMaxValue(1000),
      )
      .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this member'))
      .addStringOption((o) =>
        o
          .setName('contains')
          .setDescription('Only delete messages containing this text')
          .setMaxLength(200),
      ),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      const contains = interaction.options.getString('contains')?.toLowerCase();
      const channel = interaction.channel;

      let messages = await channel.messages.fetch({ limit: Math.min(100, amount) });
      if (user) messages = messages.filter((m) => m.author.id === user.id);
      if (contains) messages = messages.filter((m) => m.content.toLowerCase().includes(contains));

      // Grab more pages if we still need messages.
      let collected = [...messages.values()];
      let lastId = collected.at(-1)?.id;
      while (collected.length < amount && lastId && collected.length < 500) {
        const next = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
        if (!next?.size) break;
        let filtered = [...next.values()];
        if (user) filtered = filtered.filter((m) => m.author.id === user.id);
        if (contains) filtered = filtered.filter((m) => m.content.toLowerCase().includes(contains));
        collected.push(...filtered);
        lastId = next.last().id;
      }

      collected = collected.slice(0, amount);
      const fresh = collected.filter((m) => Date.now() - m.createdTimestamp < 14 * 86400000);

      let deleted = 0;
      for (let i = 0; i < fresh.length; i += 100) {
        const batch = fresh.slice(i, i + 100);
        if (batch.length === 1) {
          await batch[0].delete().then(() => (deleted += 1)).catch(() => {});
        } else {
          const res = await channel.bulkDelete(batch, true).catch(() => null);
          deleted += res?.size ?? 0;
        }
      }

      await logEvent(interaction.guild, 'modlog_channel', modLogEmbed({
        title: 'Purge',
        color: C.warn,
        description: `${interaction.user.tag} deleted **${deleted}** message(s) in <#${channel.id}>.`,
      }));

      return interaction.editReply({
        embeds: [
          ok(
            `Deleted **${deleted}** message(s) in ${channel}.` +
              (collected.length > fresh.length ? '\n-# Messages older than 14 days cannot be bulk deleted.' : ''),
          ),
        ],
      });
    },
  },

  /* SLOWMODE ─────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('Set channel slowmode')
      .setDefaultMemberPermissions(P.ManageChannels)
      .setDMPermission(false)
      .addIntegerOption((o) =>
        o.setName('seconds').setDescription('0 disables (max 21600)').setRequired(true).setMinValue(0).setMaxValue(21600),
      ),
    async execute(interaction) {
      const seconds = interaction.options.getInteger('seconds');
      await interaction.channel.setRateLimitPerUser(seconds, `By ${interaction.user.tag}`);
      return interaction.editReply({
        embeds: [ok(seconds === 0 ? 'Slowmode **disabled**.' : `Slowmode set to **${formatDuration(seconds * 1000)}**.`)],
      });
    },
  },

  /* LOCK / UNLOCK / HIDE / UNHIDE ────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Prevent @everyone from talking in this channel')
      .setDefaultMemberPermissions(P.ManageChannels)
      .setDMPermission(false)
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Channel (defaults to this one)').addChannelTypes(ChannelType.GuildText),
      ),
    async execute(interaction) {
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      await channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false, AddReactions: false },
        { reason: `Locked by ${interaction.user.tag}` },
      );
      return interaction.editReply({ embeds: [ok(`🔒 Locked ${channel}.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Allow @everyone to talk in this channel again')
      .setDefaultMemberPermissions(P.ManageChannels)
      .setDMPermission(false)
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Channel (defaults to this one)').addChannelTypes(ChannelType.GuildText),
      ),
    async execute(interaction) {
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      await channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: null, AddReactions: null },
        { reason: `Unlocked by ${interaction.user.tag}` },
      );
      return interaction.editReply({ embeds: [ok(`🔓 Unlocked ${channel}.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('hide')
      .setDescription('Hide this channel from @everyone')
      .setDefaultMemberPermissions(P.ManageChannels)
      .setDMPermission(false),
    async execute(interaction) {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        ViewChannel: false,
      });
      return interaction.editReply({ embeds: [ok('🙈 Channel hidden.')] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unhide')
      .setDescription('Make this channel visible to @everyone')
      .setDefaultMemberPermissions(P.ManageChannels)
      .setDMPermission(false),
    async execute(interaction) {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        ViewChannel: null,
      });
      return interaction.editReply({ embeds: [ok('👀 Channel visible again.')] });
    },
  },

  /* NICK ─────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('nick')
      .setDescription("Change or reset a member's nickname")
      .setDefaultMemberPermissions(P.ManageNicknames)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('nickname').setDescription('Leave empty to reset').setMaxLength(32)),
    async execute(interaction) {
      const target = interaction.options.getMember('user');
      if (!target) return interaction.editReply({ embeds: [fail('That member is not in this server.')] });
      const problem = hierarchyProblem(interaction.member, target, interaction.guild.members.me);
      if (problem && target.id !== interaction.user.id) return interaction.editReply({ embeds: [fail(problem)] });

      const nickname = interaction.options.getString('nickname');
      await target.setNickname(nickname ?? null, `By ${interaction.user.tag}`);
      return interaction.editReply({
        embeds: [ok(nickname ? `Nickname set to **${nickname}**.` : 'Nickname reset.')],
      });
    },
  },

  /* ROLE ─────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('role')
      .setDescription('Add or remove a role from a member')
      .setDefaultMemberPermissions(P.ManageRoles)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a role')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a role')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('all')
          .setDescription('Add a role to every human member')
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'all') {
        const role = interaction.options.getRole('role');
        if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position)
          return interaction.editReply({ embeds: [fail('I cannot assign that role — check its position.')] });
        const members = await interaction.guild.members.fetch();
        const targets = members.filter((m) => !m.user.bot && !m.roles.cache.has(role.id));
        await interaction.editReply({ embeds: [ok(`Adding ${role} to **${targets.size}** members…`, 'Working')] });
        let done = 0;
        for (const member of targets.values()) {
          await member.roles.add(role, `Mass role by ${interaction.user.tag}`).then(() => (done += 1)).catch(() => {});
        }
        return interaction.editReply({ embeds: [ok(`Added ${role} to **${done}** member(s).`)] });
      }

      const target = interaction.options.getMember('user');
      const role = interaction.options.getRole('role');
      if (!target) return interaction.editReply({ embeds: [fail('That member is not in this server.')] });
      if (role.position >= interaction.guild.members.me.roles.highest.position)
        return interaction.editReply({ embeds: [fail('That role is above my highest role.')] });

      if (sub === 'add') {
        if (target.roles.cache.has(role.id)) return interaction.editReply({ embeds: [fail('They already have that role.')] });
        await target.roles.add(role, `By ${interaction.user.tag}`);
        await logEvent(interaction.guild, 'modlog_channel', modLogEmbed({
          title: 'Role added',
          color: C.ok,
          fields: [
            { name: 'Member', value: `<@${target.id}>`, inline: true },
            { name: 'Role', value: `${role}`, inline: true },
            { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          ],
        }));
        return interaction.editReply({ embeds: [ok(`Added ${role} to <@${target.id}>.`)] });
      }

      if (!target.roles.cache.has(role.id)) return interaction.editReply({ embeds: [fail('They do not have that role.')] });
      await target.roles.remove(role, `By ${interaction.user.tag}`);
      await logEvent(interaction.guild, 'modlog_channel', modLogEmbed({
        title: 'Role removed',
        color: C.warn,
        fields: [
          { name: 'Member', value: `<@${target.id}>`, inline: true },
          { name: 'Role', value: `${role}`, inline: true },
        ],
      }));
      return interaction.editReply({ embeds: [ok(`Removed ${role} from <@${target.id}>.`)] });
    },
  },

  /* UNBANALL ─────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('unbanall')
      .setDescription('Unban every banned user (confirmation required)')
      .setDefaultMemberPermissions(P.Administrator)
      .setDMPermission(false),
    async execute(interaction) {
      const bans = await interaction.guild.bans.fetch();
      if (!bans.size) return interaction.editReply({ embeds: [fail('There are no bans.')] });

      await interaction.editReply({
        embeds: [embed({ title: `Unban ${bans.size} users?`, description: 'This cannot be undone.', color: C.warn })],
        components: [row(btn.danger('unbanall:confirm', 'Unban everyone'), btn.secondary('unbanall:cancel', 'Cancel'))],
      });
    },
  },
];

/* handled in events/interactionCreate.js via this export */
export const components = {
  async 'unbanall:confirm'(interaction) {
    const bans = await interaction.guild.bans.fetch();
    let done = 0;
    for (const ban of bans.values()) {
      await interaction.guild.bans
        .remove(ban.user.id, `Mass unban by ${interaction.user.tag}`)
        .then(() => (done += 1))
        .catch(() => {});
    }
    return interaction.update({ embeds: [ok(`Unbanned **${done}** user(s).`)], components: [] });
  },
  async 'unbanall:cancel'(interaction) {
    return interaction.update({ embeds: [fail('Cancelled.')], components: [] });
  },
};

registerTask('unban', async ({ guildId, userId, caseId }, client) => {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  await guild.bans.remove(userId, `Temporary ban #${caseId} expired`).catch(() => {});
  db.prepare('UPDATE cases SET active = 0 WHERE id = ?').run(caseId);
  await logEvent(guild, 'modlog_channel', modLogEmbed({
    title: `Tempban expired │ Case #${caseId}`,
    color: C.ok,
    description: `<@${userId}> was automatically unbanned.`,
  }));
});

export default { category, commands, components };
