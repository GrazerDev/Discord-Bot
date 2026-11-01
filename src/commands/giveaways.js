import { SlashCommandBuilder, PermissionFlagsBits as P } from 'discord.js';
import { db } from '../db.js';
import { embed, ok, fail, field, C, row, btn, EPH } from '../lib/ui.js';
import { parseDuration, formatDuration, timestamp, shuffle, truncate } from '../lib/helpers.js';
import { registerTask } from '../lib/scheduler.js';

const category = 'Giveaways';

const EMBED_COLOR = 0xf1c40f;

const giveawayEmbed = (giveaway, { ended = false, winners = [] } = {}) =>
  embed({
    title: `🎉 ${truncate(giveaway.prize, 250)}`,
    description:
      (giveaway.description ? `${giveaway.description}\n\n` : '') +
      (ended
        ? `**Ended**\nWinners: ${winners.length ? winners.map((w) => `<@${w}>`).join(', ') : '*no valid entries*'}`
        : `Ends ${timestamp(giveaway.ends_at)}\nClick the button below to enter!`),
    color: ended ? C.muted : EMBED_COLOR,
    fields: [
      field('Winners', String(giveaway.winners)),
      field('Hosted by', `<@${giveaway.host_id}>`),
      ...(giveaway.req_role ? [field('Required role', `<@&${giveaway.req_role}>`)] : []),
      ...(giveaway.req_level ? [field('Required level', String(giveaway.req_level))] : []),
    ],
    footer: { text: `Giveaway #${giveaway.id}` },
  });

const entryRow = (giveaway, disabled = false) =>
  row(btn.primary('gw:enter', 'Enter giveaway', '🎉').setDisabled(disabled));

const getGiveaway = (guildId, id) =>
  db.prepare('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?').get(id, guildId);

async function finish(client, giveaway) {
  db.prepare('UPDATE giveaways SET ended = 1 WHERE id = ?').run(giveaway.id);

  const rows = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(giveaway.id);
  const winners = shuffle(rows.map((r) => r.user_id)).slice(0, giveaway.winners);

  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (channel?.isTextBased()) {
    const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
    if (message)
      await message
        .edit({ embeds: [giveawayEmbed(giveaway, { ended: true, winners })], components: [entryRow(giveaway, true)] })
        .catch(() => {});

    if (winners.length) {
      await channel
        .send({
          content: `🎉 Congratulations ${winners.map((w) => `<@${w}>`).join(', ')} — you won **${truncate(giveaway.prize, 200)}**!\n[jump to giveaway](${message?.url ?? ''})`,
          allowedMentions: { users: winners },
        })
        .catch(() => {});
    } else {
      await channel.send({ content: '😔 The giveaway ended with no valid entries.' }).catch(() => {});
    }
  }

  db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(winners.join(','), giveaway.id);
  return winners;
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Run giveaways')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('start')
          .setDescription('Start a giveaway in this channel')
          .addStringOption((o) => o.setName('prize').setDescription('What are you giving away?').setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName('duration').setDescription('e.g. 30m, 2h, 3d').setRequired(true))
          .addIntegerOption((o) => o.setName('winners').setDescription('How many winners (default 1)').setMinValue(1).setMaxValue(50))
          .addStringOption((o) => o.setName('description').setDescription('Extra text').setMaxLength(500))
          .addRoleOption((o) => o.setName('required_role').setDescription('Only this role may enter'))
          .addIntegerOption((o) => o.setName('required_level').setDescription('Minimum level required to enter').setMinValue(1)),
      )
      .addSubcommand((s) =>
        s
          .setName('end')
          .setDescription('End a giveaway immediately')
          .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) =>
        s
          .setName('reroll')
          .setDescription('Pick a new winner for an ended giveaway')
          .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) =>
        s
          .setName('delete')
          .setDescription('Delete a giveaway and its entries')
          .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('List giveaways in this server')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'start') {
        const duration = parseDuration(interaction.options.getString('duration'));
        if (!duration || duration < 10000)
          return interaction.editReply({ embeds: [fail('Duration must be at least 10 seconds (e.g. `10m`, `2h`, `3d`).')] });

        const giveaway = {
          guild_id: interaction.guild.id,
          channel_id: interaction.channel.id,
          prize: interaction.options.getString('prize'),
          description: interaction.options.getString('description') ?? null,
          winners: interaction.options.getInteger('winners') ?? 1,
          ends_at: Date.now() + duration,
          host_id: interaction.user.id,
          req_role: interaction.options.getRole('required_role')?.id ?? null,
          req_level: interaction.options.getInteger('required_level') ?? 0,
        };

        const message = await interaction.channel.send({
          embeds: [giveawayEmbed({ ...giveaway, id: 0 })],
          components: [entryRow(giveaway)],
        });
        const info = db
          .prepare(
            `INSERT INTO giveaways (guild_id, channel_id, message_id, prize, description, winners, ends_at, host_id, req_role, req_level)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            giveaway.guild_id, giveaway.channel_id, message.id, giveaway.prize, giveaway.description,
            giveaway.winners, giveaway.ends_at, giveaway.host_id, giveaway.req_role, giveaway.req_level,
          );

        const saved = getGiveaway(interaction.guild.id, Number(info.lastInsertRowid));
        await message.edit({ embeds: [giveawayEmbed(saved)], components: [entryRow(saved)] });

        return interaction.editReply({
          embeds: [ok(`Giveaway **#${saved.id}** started for **${saved.prize}**.\nEnds ${timestamp(saved.ends_at)} (in ${formatDuration(duration)}).`)],
        });
      }

      const id = interaction.options.getInteger('id');
      const giveaway = getGiveaway(interaction.guild.id, id);
      if (!giveaway) return interaction.editReply({ embeds: [fail(`No giveaway with ID **${id}**.`)] });

      if (sub === 'end') {
        if (giveaway.ended) return interaction.editReply({ embeds: [fail('That giveaway already ended.')] });
        const winners = await finish(interaction.client, giveaway);
        return interaction.editReply({
          embeds: [ok(winners.length ? `Ended. Winners: ${winners.map((w) => `<@${w}>`).join(', ')}` : 'Ended with no entries.')],
        });
      }

      if (sub === 'reroll') {
        if (!giveaway.ended) return interaction.editReply({ embeds: [fail('End that giveaway first.')] });
        const rows = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(giveaway.id);
        if (!rows.length) return interaction.editReply({ embeds: [fail('Nobody entered that giveaway.')] });
        const [winner] = shuffle(rows.map((r) => r.user_id));
        return interaction.editReply({
          embeds: [ok(`🎉 New winner for **${giveaway.prize}**: <@${winner}>`)],
        });
      }

      if (sub === 'delete') {
        db.prepare('DELETE FROM giveaways WHERE id = ?').run(giveaway.id);
        db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ?').run(giveaway.id);
        const channel = await interaction.client.channels.fetch(giveaway.channel_id).catch(() => null);
        const message = await channel?.messages?.fetch(giveaway.message_id).catch(() => null);
        await message?.delete().catch(() => {});
        return interaction.editReply({ embeds: [ok(`Giveaway #${id} deleted.`)] });
      }

      const rows = db.prepare('SELECT * FROM giveaways WHERE guild_id = ? ORDER BY id DESC LIMIT 15').all(interaction.guild.id);
      if (!rows.length) return interaction.editReply({ embeds: [fail('No giveaways yet.')] });
      return interaction.editReply({
        embeds: [
          embed({
            title: '🎉 Giveaways',
            color: EMBED_COLOR,
            description: rows
              .map(
                (g) =>
                  `**#${g.id}** ${truncate(g.prize, 60)} — ${g.ended ? '`ended`' : `ends ${timestamp(g.ends_at)}`} • ${db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?').get(g.id).n} entries`,
              )
              .join('\n'),
          }),
        ],
      });
    },
  },
];

const components = {
  async 'gw:enter'(interaction) {
    const giveaway = db.prepare('SELECT * FROM giveaways WHERE message_id = ?').get(interaction.message.id);
    if (!giveaway) return interaction.reply({ embeds: [fail('This giveaway no longer exists.')], flags: EPH });
    if (giveaway.ended) return interaction.reply({ embeds: [fail('This giveaway has ended.')], flags: EPH });

    if (giveaway.req_role && !interaction.member.roles.cache.has(giveaway.req_role))
      return interaction.reply({ embeds: [fail(`You need <@&${giveaway.req_role}> to enter.`)], flags: EPH });

    if (giveaway.req_level) {
      const row = db
        .prepare('SELECT xp FROM levels WHERE guild_id = ? AND user_id = ?')
        .get(interaction.guild.id, interaction.user.id);
      // level check happens against the stored level column if present
      const lvl = db
        .prepare('SELECT level FROM levels WHERE guild_id = ? AND user_id = ?')
        .get(interaction.guild.id, interaction.user.id)?.level ?? 0;
      if (!row || lvl < giveaway.req_level)
        return interaction.reply({ embeds: [fail(`You need to be level **${giveaway.req_level}** to enter.`)], flags: EPH });
    }

    const existing = db
      .prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?')
      .get(giveaway.id, interaction.user.id);

    if (existing) {
      db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(giveaway.id, interaction.user.id);
      return interaction.reply({ embeds: [ok('👋 You left the giveaway.')], flags: EPH });
    }

    db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(giveaway.id, interaction.user.id);
    const count = db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?').get(giveaway.id).n;
    return interaction.reply({ embeds: [ok(`🎉 You entered! Good luck.\n**${count}** entries so far.`)], flags: EPH });
  },
};

registerTask('giveaway', async (giveaway, client) => {
  await finish(client, giveaway);
});

export default { category, commands, components };
