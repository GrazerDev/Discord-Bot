import { SlashCommandBuilder, PermissionFlagsBits as P, ButtonStyle } from 'discord.js';
import { db, getGuild } from '../db.js';
import { embed, ok, fail, field, C, row, btn, EPH } from '../lib/ui.js';
import { truncate, progressBar, timestamp } from '../lib/helpers.js';

const category = 'Social';

const STATUS_STYLES = {
  open: { emoji: '🕐', color: C.brand, label: 'Open' },
  approved: { emoji: '✅', color: C.ok, label: 'Approved' },
  denied: { emoji: '❌', color: C.error, label: 'Denied' },
  implemented: { emoji: '🚀', color: 0x9b59b6, label: 'Implemented' },
};

const suggestionEmbed = (row, extra) => {
  const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.open;
  const total = row.upvotes + row.downvotes;
  const pct = total ? Math.round((row.upvotes / total) * 100) : 0;
  return embed({
    title: `${style.emoji} Suggestion #${row.id} — ${style.label}`,
    description: row.content,
    color: style.color,
    fields: [
      field('Submitted by', `<@${row.author_id}>`),
      field('When', timestamp(row.created_at, 'R')),
      { name: `Votes — 👍 ${row.upvotes} · 👎 ${row.downvotes}`, value: `${progressBar(row.upvotes, Math.max(total, 1), 12)} ${pct}%`, inline: false },
      ...(extra ? [{ name: 'Staff note', value: extra, inline: false }] : []),
    ],
    footer: { text: `Suggestion #${row.id}` },
  });
};

const voteRow = (row, disabled = false) =>
  row(
    btn.success(`sug:up:${row.id}`, `Upvote (${row.upvotes})`, '👍').setDisabled(disabled),
    btn.danger(`sug:down:${row.id}`, `Downvote (${row.downvotes})`, '👎').setDisabled(disabled),
  );

const pollEmbed = (question, labels, counts, footer) => {
  const total = counts.reduce((a, b) => a + b, 0);
  const lines = labels.map((label, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    return `**${label}**\n${progressBar(counts[i], Math.max(total, 1), 14)} ${pct}% (${counts[i]})`;
  });
  return embed({
    title: `📊 ${question}`,
    description: lines.join('\n\n'),
    color: C.brand,
    footer: { text: footer ?? `${total} vote(s) — click a button to vote, click again to remove` },
  });
};

const commands = [
  /* SUGGEST ──────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('suggest')
      .setDescription('Submit a suggestion for this server')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true).setMaxLength(1500)),
    async execute(interaction) {
      const settings = getGuild(interaction.guild.id);
      if (!settings.suggestions_channel)
        return interaction.editReply({ embeds: [fail('No suggestions channel set up. An admin can run `/suggestconfig`.')] });

      const channel = interaction.guild.channels.cache.get(settings.suggestions_channel);
      if (!channel?.isTextBased()) return interaction.editReply({ embeds: [fail('The suggestions channel is missing.')] });

      const content = interaction.options.getString('idea');
      const placeholder = {
        id: 0,
        content,
        author_id: interaction.user.id,
        created_at: Date.now(),
        status: 'open',
        upvotes: 0,
        downvotes: 0,
      };

      const message = await channel.send({ embeds: [suggestionEmbed(placeholder)], components: [voteRow(placeholder)] });
      const info = db
        .prepare('INSERT INTO suggestions (guild_id, message_id, channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(interaction.guild.id, message.id, channel.id, interaction.user.id, content, Date.now());

      const saved = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(Number(info.lastInsertRowid));
      await message.edit({ embeds: [suggestionEmbed(saved)], components: [voteRow(saved)] });

      return interaction.editReply({ embeds: [ok(`Suggestion **#${saved.id}** posted in ${channel}.`)] });
    },
  },

  /* SUGGESTION MANAGEMENT ────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('suggestion')
      .setDescription('Manage suggestions (staff)')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('status')
          .setDescription('Change a suggestion’s status')
          .addIntegerOption((o) => o.setName('id').setDescription('Suggestion ID').setRequired(true).setMinValue(1))
          .addStringOption((o) =>
            o
              .setName('status')
              .setDescription('New status')
              .setRequired(true)
              .addChoices(
                { name: 'Approved', value: 'approved' },
                { name: 'Denied', value: 'denied' },
                { name: 'Implemented', value: 'implemented' },
                { name: 'Open', value: 'open' },
              ),
          )
          .addStringOption((o) => o.setName('note').setDescription('Staff note shown on the embed').setMaxLength(500)),
      )
      .addSubcommand((s) =>
        s
          .setName('delete')
          .setDescription('Delete a suggestion')
          .addIntegerOption((o) => o.setName('id').setDescription('Suggestion ID').setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('List recent suggestions')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'list') {
        const rows = db.prepare('SELECT * FROM suggestions WHERE guild_id = ? ORDER BY id DESC LIMIT 15').all(interaction.guild.id);
        if (!rows.length) return interaction.editReply({ embeds: [fail('No suggestions yet.')] });
        return interaction.editReply({
          embeds: [
            embed({
              title: 'Suggestions',
              color: C.brand,
              description: rows
                .map((r) => `${STATUS_STYLES[r.status].emoji} **#${r.id}** ${truncate(r.content, 70)} — 👍 ${r.upvotes} 👎 ${r.downvotes}`)
                .join('\n'),
            }),
          ],
        });
      }

      const id = interaction.options.getInteger('id');
      const suggestion = db.prepare('SELECT * FROM suggestions WHERE id = ? AND guild_id = ?').get(id, interaction.guild.id);
      if (!suggestion) return interaction.editReply({ embeds: [fail(`No suggestion with ID **${id}**.`)] });

      const channel = interaction.guild.channels.cache.get(suggestion.channel_id);
      const message = await channel?.messages?.fetch(suggestion.message_id).catch(() => null);

      if (sub === 'delete') {
        db.prepare('DELETE FROM suggestions WHERE id = ?').run(id);
        await message?.delete().catch(() => {});
        return interaction.editReply({ embeds: [ok(`Suggestion #${id} deleted.`)] });
      }

      const status = interaction.options.getString('status');
      const note = interaction.options.getString('note');
      db.prepare('UPDATE suggestions SET status = ? WHERE id = ?').run(status, id);
      const updated = { ...suggestion, status };
      await message?.edit({ embeds: [suggestionEmbed(updated, note)], components: [voteRow(updated, status !== 'open')] }).catch(() => {});
      return interaction.editReply({ embeds: [ok(`Suggestion #${id} marked **${status}**.`)] });
    },
  },

  /* POLL ─────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Create a live poll with buttons')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('question').setDescription('The question').setRequired(true).setMaxLength(250))
      .addStringOption((o) => o.setName('option1').setDescription('Option 1').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('option2').setDescription('Option 2').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('option3').setDescription('Option 3').setMaxLength(80))
      .addStringOption((o) => o.setName('option4').setDescription('Option 4').setMaxLength(80))
      .addStringOption((o) => o.setName('option5').setDescription('Option 5').setMaxLength(80)),
    async execute(interaction) {
      const question = interaction.options.getString('question');
      const labels = [1, 2, 3, 4, 5].map((n) => interaction.options.getString(`option${n}`)).filter(Boolean);
      const counts = labels.map(() => 0);

      const message = await interaction.channel.send({
        embeds: [pollEmbed(question, labels, counts, `0 votes — created by ${interaction.user.username}`)],
        components: [row(...labels.map((l, i) => btn.secondary(`poll:${i}`, truncate(l, 78))))],
      });

      return interaction.editReply({ embeds: [ok(`Poll posted: ${message.url}`)] });
    },
  },

];

const components = {
  async 'sug:up'(interaction) {
    return vote(interaction, 'up');
  },
  async 'sug:down'(interaction) {
    return vote(interaction, 'down');
  },

  async poll(interaction, args) {
    const choice = Number(args[0]);
    const messageId = interaction.message.id;
    const existing = db
      .prepare('SELECT * FROM poll_votes WHERE message_id = ? AND user_id = ?')
      .get(messageId, interaction.user.id);

    if (existing && existing.choice === choice) {
      db.prepare('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?').run(messageId, interaction.user.id);
    } else {
      db.prepare('INSERT INTO poll_votes (message_id, user_id, choice) VALUES (?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET choice = excluded.choice')
        .run(messageId, interaction.user.id, choice);
    }

    const votes = db.prepare('SELECT choice, COUNT(*) AS n FROM poll_votes WHERE message_id = ? GROUP BY choice').all(messageId);
    const labels = interaction.message.components[0].components.map((b) => b.label);
    const counts = labels.map((_, i) => votes.find((v) => v.choice === i)?.n ?? 0);
    const question = (interaction.message.embeds[0]?.title ?? 'Poll').replace(/^📊\s*/, '');

    return interaction.update({
      embeds: [pollEmbed(question, labels, counts)],
      components: interaction.message.components,
    });
  },
};

async function vote(interaction, direction) {
  const id = Number(interaction.customId.split(':')[2]);
  const suggestion = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id);
  if (!suggestion) return interaction.reply({ embeds: [fail('That suggestion was deleted.')], flags: EPH });
  if (suggestion.status !== 'open')
    return interaction.reply({ embeds: [fail('Voting is closed on this suggestion.')], flags: EPH });

  const key = `sug:${id}`;
  const want = direction === 'up' ? 1 : 0;
  const prev = db.prepare('SELECT choice FROM poll_votes WHERE message_id = ? AND user_id = ?').get(key, interaction.user.id);

  const bump = (column, delta) =>
    db.prepare(`UPDATE suggestions SET ${column} = MAX(0, ${column} + ?) WHERE id = ?`).run(delta, id);

  if (prev) {
    if (prev.choice === want) {
      // clicking the same button again removes the vote
      db.prepare('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?').run(key, interaction.user.id);
      bump(want === 1 ? 'upvotes' : 'downvotes', -1);
    } else {
      db.prepare('UPDATE poll_votes SET choice = ? WHERE message_id = ? AND user_id = ?').run(want, key, interaction.user.id);
      bump(prev.choice === 1 ? 'upvotes' : 'downvotes', -1);
      bump(want === 1 ? 'upvotes' : 'downvotes', 1);
    }
  } else {
    db.prepare('INSERT INTO poll_votes (message_id, user_id, choice) VALUES (?, ?, ?)').run(key, interaction.user.id, want);
    bump(want === 1 ? 'upvotes' : 'downvotes', 1);
  }

  const fresh = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id);
  return interaction.update({ embeds: [suggestionEmbed(fresh)], components: [voteRow(fresh)] });
}

export default { category, commands, components };
