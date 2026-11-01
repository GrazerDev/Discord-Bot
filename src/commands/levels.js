import { SlashCommandBuilder, PermissionFlagsBits as P } from 'discord.js';
import { getGuild, getLevelRow, levelFromXp, xpForLevel, db } from '../db.js';
import { embed, ok, fail, field, C } from '../lib/ui.js';
import { formatNumber, progressBar } from '../lib/helpers.js';
import { config } from '../config.js';

const category = 'Levels';

const rankCard = async (guild, userId) => {
  const row = getLevelRow(guild.id, userId);
  const { level, intoLevel, needed } = levelFromXp(row.xp);
  const { rank } = db
    .prepare('SELECT COUNT(*) + 1 AS rank FROM levels WHERE guild_id = ? AND xp > ?')
    .get(guild.id, row.xp);

  const member = await guild.members.fetch(userId).catch(() => null);
  return embed({
    title: `${member?.displayName ?? 'Unknown'} │ Level ${level}`,
    color: C.brand,
    thumbnail: member?.displayAvatarURL({ size: 256 }),
    fields: [
      field('Rank', `#${rank}`),
      field('Total XP', formatNumber(row.xp)),
      field('Messages', formatNumber(row.messages)),
      { name: `Progress to level ${level + 1}`, value: `${progressBar(intoLevel, needed, 14)} ${formatNumber(intoLevel)}/${formatNumber(needed)} XP`, inline: false },
    ],
  });
};

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Show your level and XP')
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') ?? interaction.user;
      return interaction.editReply({ embeds: [await rankCard(interaction.guild, user.id)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('levelboard')
      .setDescription('Top members by XP')
      .setDMPermission(false),
    async execute(interaction) {
      const rows = db
        .prepare('SELECT user_id, xp, level FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT 15')
        .all(interaction.guild.id);
      if (!rows.length) return interaction.editReply({ embeds: [fail('Nobody has earned XP yet.')] });

      const members = await interaction.guild.members.fetch({ user: rows.map((r) => r.user_id) }).catch(() => null);
      const medals = ['🥇', '🥈', '🥉'];
      const description = rows
        .map((r, i) => {
          const { level } = levelFromXp(r.xp);
          const name = members?.get(r.user_id)?.displayName ?? `<@${r.user_id}>`;
          return `${medals[i] ?? `**${i + 1}.**`} ${name} — level **${level}** · ${formatNumber(r.xp)} XP`;
        })
        .join('\n');

      return interaction.editReply({ embeds: [embed({ title: `🏆 XP Leaderboard │ ${interaction.guild.name}`, description, color: C.warn })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('xp')
      .setDescription('Manage XP (staff only)')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Give XP to a member')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
          .addIntegerOption((o) => o.setName('amount').setDescription('XP').setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Take XP from a member')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
          .addIntegerOption((o) => o.setName('amount').setDescription('XP').setRequired(true).setMinValue(1)),
      )
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Set a member’s XP')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
          .addIntegerOption((o) => o.setName('amount').setDescription('XP').setRequired(true).setMinValue(0)),
      )
      .addSubcommand((s) =>
        s
          .setName('reset')
          .setDescription('Reset a member’s XP')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser('user');
      const row = getLevelRow(interaction.guild.id, user.id);

      if (sub === 'reset') {
        db.prepare('UPDATE levels SET xp = 0, level = 0, messages = 0 WHERE guild_id = ? AND user_id = ?').run(interaction.guild.id, user.id);
        return interaction.editReply({ embeds: [ok(`Reset XP for **${user.tag}**.`)] });
      }

      const amount = interaction.options.getInteger('amount');
      const nextXp = Math.max(0, sub === 'add' ? row.xp + amount : sub === 'remove' ? row.xp - amount : amount);
      const { level } = levelFromXp(nextXp);
      db.prepare('UPDATE levels SET xp = ?, level = ? WHERE guild_id = ? AND user_id = ?').run(nextXp, level, interaction.guild.id, user.id);
      return interaction.editReply({ embeds: [ok(`**${user.tag}** is now level **${level}** with **${formatNumber(nextXp)}** XP.`)] });
    },
  },
];

/* Called from the messageCreate event */
export async function handleMessageXp(message) {
  if (!config.features.levels) return;
  const settings = getGuild(message.guild.id);
  if (!settings.levels_enabled) return;

  const userId = message.author.id;
  const row = getLevelRow(message.guild.id, userId);
  const now = Date.now();
  if (now - row.last_xp < settings.xp_cooldown) {
    db.prepare('UPDATE levels SET messages = messages + 1 WHERE guild_id = ? AND user_id = ?').run(message.guild.id, userId);
    return;
  }

  const gained = Math.floor(Math.random() * (settings.xp_max - settings.xp_min + 1)) + settings.xp_min;
  const nextXp = row.xp + gained;
  const before = levelFromXp(row.xp).level;
  const after = levelFromXp(nextXp);

  db.prepare('UPDATE levels SET xp = ?, level = ?, messages = messages + 1, last_xp = ? WHERE guild_id = ? AND user_id = ?')
    .run(nextXp, after.level, now, message.guild.id, userId);

  if (after.level > before) {
    const member = message.member;
    if (!member) return;

    // Level rewards
    const rewards = db
      .prepare('SELECT * FROM level_rewards WHERE guild_id = ? AND level <= ? ORDER BY level ASC')
      .all(message.guild.id, after.level);
    for (const reward of rewards) {
      if (!member.roles.cache.has(reward.role_id)) {
        await member.roles.add(reward.role_id, `Level ${reward.level} reward`).catch(() => {});
      }
    }

    const channel = settings.level_channel ? message.guild.channels.cache.get(settings.level_channel) : message.channel;
    if (channel?.isTextBased()) {
      await channel
        .send({
          embeds: [
            embed({
              description: `🎉 ${member} just reached **level ${after.level}**!`,
              color: C.ok,
              timestamp: false,
            }),
          ],
        })
        .catch(() => {});
    }
  }
}

export default { category, commands };
