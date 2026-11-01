import { SlashCommandBuilder } from 'discord.js';
import { db } from '../db.js';
import { embed, ok, fail, field, C } from '../lib/ui.js';
import { parseDuration, formatDuration, timestamp, truncate } from '../lib/helpers.js';
import { registerTask } from '../lib/scheduler.js';

const category = 'Reminders';

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('remind')
      .setDescription('Set and manage reminders')
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Get pinged after a delay')
          .addStringOption((o) => o.setName('time').setDescription('e.g. 10m, 2h, 3d').setRequired(true))
          .addStringOption((o) => o.setName('message').setDescription('What to remind you about').setRequired(true).setMaxLength(500)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('List your reminders'))
      .addSubcommand((s) =>
        s
          .setName('cancel')
          .setDescription('Cancel a reminder')
          .addIntegerOption((o) => o.setName('id').setDescription('Reminder ID (see /remind list)').setRequired(true).setMinValue(1)),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const userId = interaction.user.id;

      if (sub === 'set') {
        const duration = parseDuration(interaction.options.getString('time'));
        if (!duration || duration < 10_000)
          return interaction.editReply({ embeds: [fail('Use at least 10 seconds, e.g. `10m`, `2h`, `1d`.')] });

        const message = interaction.options.getString('message');
        const remindAt = Date.now() + duration;
        const info = db
          .prepare('INSERT INTO reminders (guild_id, channel_id, user_id, message, remind_at) VALUES (?, ?, ?, ?, ?)')
          .run(interaction.guild.id, interaction.channel.id, userId, message, remindAt);

        return interaction.editReply({
          embeds: [
            ok(
              `⏰ Reminder **#${info.lastInsertRowid}** set for ${timestamp(remindAt, 'f')} (in **${formatDuration(duration)}**).\n> ${truncate(message, 300)}`,
            ),
          ],
        });
      }

      if (sub === 'list') {
        const rows = db
          .prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at ASC LIMIT 20')
          .all(userId);
        if (!rows.length) return interaction.editReply({ embeds: [fail('You have no reminders.')] });
        return interaction.editReply({
          embeds: [
            embed({
              title: '⏰ Your reminders',
              color: C.brand,
              description: rows
                .map((r) => `**#${r.id}** ${timestamp(r.remind_at)} — ${truncate(r.message, 100)}${r.guild_id ? ` (<#${r.channel_id}>)` : ''}`)
                .join('\n'),
            }),
          ],
        });
      }

      const id = interaction.options.getInteger('id');
      const reminder = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(id, userId);
      if (!reminder) return interaction.editReply({ embeds: [fail(`You have no reminder #${id}.`)] });
      db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
      return interaction.editReply({ embeds: [ok(`Reminder #${id} cancelled.`)] });
    },
  },
];

registerTask('reminder', async (reminder, client) => {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(reminder.id);
  const payload = {
    content: `⏰ <@${reminder.user_id}>, you asked me to remind you:\n> ${reminder.message}`,
    allowedMentions: { users: [reminder.user_id] },
  };

  const channel = await client.channels.fetch(reminder.channel_id).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send(payload).catch(() => {});
    return;
  }
  const user = await client.users.fetch(reminder.user_id).catch(() => null);
  await user?.send(payload).catch(() => {});
});

export default { category, commands };
