import { SlashCommandBuilder } from 'discord.js';
import { db } from '../db.js';
import { embed, ok, fail, field, C } from '../lib/ui.js';
import { formatNumber, rand, pick, timestamp, formatDuration, chance } from '../lib/helpers.js';
import { config } from '../config.js';

const category = 'Economy';
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 604_800_000;

const ensure = (guildId, userId) =>
  db.prepare('INSERT OR IGNORE INTO economy (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);

const getEco = (guildId, userId) => {
  ensure(guildId, userId);
  return db.prepare('SELECT * FROM economy WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
};

const SYMBOL = '🪙';

const JOBS = [
  'worked a shift at the coffee shop',
  'fixed a production bug at 3am',
  'streamed for six hours',
  'delivered 40 packages',
  'tutored a student in maths',
  'walked a very good dog',
  'sold some old furniture',
  'wrote articles for a tech blog',
  'won a small poker game',
  'cleaned out a garage',
];

const BEG_REPLIES = [
  'A stranger tossed you {amt}.',
  'Someone felt bad and gave you {amt}.',
  'You found {amt} in the sofa cushions.',
  'A kind soul handed you {amt}.',
  'You got {amt} for looking sad enough.',
];

const SLOT_ITEMS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];

const amountOption = (o) =>
  o.setName('amount').setDescription('How many coins').setRequired(true).setMinValue(1);

const balanceLine = (eco, member) =>
  `**Wallet:** ${SYMBOL} ${formatNumber(eco.wallet)}\n**Bank:** ${SYMBOL} ${formatNumber(eco.bank)}\n**Net worth:** ${SYMBOL} ${formatNumber(eco.wallet + eco.bank)}`;

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check wallets and move coins in and out of the bank')
      .addSubcommand((s) =>
        s.setName('view').setDescription('Check a balance')
          .addUserOption((o) => o.setName('user').setDescription('Member')),
      )
      .addSubcommand((s) =>
        s.setName('deposit').setDescription('Move coins into the bank — safe from robbers')
          .addIntegerOption((o) => amountOption(o)),
      )
      .addSubcommand((s) =>
        s.setName('withdraw').setDescription('Take coins out of the bank')
          .addIntegerOption((o) => amountOption(o)),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser('user') ?? interaction.user;
      const eco = getEco(interaction.guild.id, user.id);

      if (sub === 'view') {
        return interaction.editReply({
          embeds: [
            embed({
              title: `${user.username}’s balance`,
              description: balanceLine(eco),
              color: C.warn,
              thumbnail: user.displayAvatarURL({ size: 256 }),
            }),
          ],
        });
      }

      const amount = interaction.options.getInteger('amount');
      if (sub === 'deposit') {
        if (eco.wallet < amount) return interaction.editReply({ embeds: [fail('Not enough coins in your wallet.')] });
        db.prepare('UPDATE economy SET wallet = wallet - ?, bank = bank + ? WHERE guild_id = ? AND user_id = ?')
          .run(amount, amount, interaction.guild.id, user.id);
        return interaction.editReply({ embeds: [ok(`Deposited ${SYMBOL} **${formatNumber(amount)}**.`)] });
      }
      if (eco.bank < amount) return interaction.editReply({ embeds: [fail('Not enough coins in your bank.')] });
      db.prepare('UPDATE economy SET wallet = wallet + ?, bank = bank - ? WHERE guild_id = ? AND user_id = ?')
        .run(amount, amount, interaction.guild.id, user.id);
      return interaction.editReply({ embeds: [ok(`Withdrew ${SYMBOL} **${formatNumber(amount)}**.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins'),
    async execute(interaction) {
      const eco = getEco(interaction.guild.id, interaction.user.id);
      const now = Date.now();
      const wait = eco.last_daily + DAY - now;
      if (wait > 0) return interaction.editReply({ embeds: [fail(`Already claimed. Come back in **${formatDuration(wait)}**.`)] });

      const continued = now - eco.last_daily < 2 * DAY;
      const streak = continued ? eco.daily_streak + 1 : 1;
      const base = rand(250, 400);
      const bonus = Math.min(streak, 10) * 25;
      const total = base + bonus;

      db.prepare('UPDATE economy SET wallet = wallet + ?, last_daily = ?, daily_streak = ? WHERE guild_id = ? AND user_id = ?')
        .run(total, now, streak, interaction.guild.id, interaction.user.id);

      return interaction.editReply({
        embeds: [
          embed({
            title: '🎁 Daily reward',
            description: `You collected ${SYMBOL} **${formatNumber(total)}** (base ${formatNumber(base)} + streak bonus ${formatNumber(bonus)}).\n🔥 Streak: **${streak} day(s)**`,
            color: C.ok,
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly coins'),
    async execute(interaction) {
      const eco = getEco(interaction.guild.id, interaction.user.id);
      const wait = eco.last_weekly + WEEK - Date.now();
      if (wait > 0) return interaction.editReply({ embeds: [fail(`Already claimed. Come back in **${formatDuration(wait)}**.`)] });
      const amount = rand(1500, 2500);
      db.prepare('UPDATE economy SET wallet = wallet + ?, last_weekly = ? WHERE guild_id = ? AND user_id = ?')
        .run(amount, Date.now(), interaction.guild.id, interaction.user.id);
      return interaction.editReply({ embeds: [ok(`You claimed your weekly ${SYMBOL} **${formatNumber(amount)}**.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('work').setDescription('Work for coins (1 hour cooldown)'),
    async execute(interaction) {
      const eco = getEco(interaction.guild.id, interaction.user.id);
      const wait = eco.last_work + HOUR - Date.now();
      if (wait > 0) return interaction.editReply({ embeds: [fail(`You are tired. Rest for **${formatDuration(wait)}**.`)] });
      const amount = rand(120, 320);
      db.prepare('UPDATE economy SET wallet = wallet + ?, last_work = ? WHERE guild_id = ? AND user_id = ?')
        .run(amount, Date.now(), interaction.guild.id, interaction.user.id);
      return interaction.editReply({ embeds: [ok(`💼 You ${pick(JOBS)} and earned ${SYMBOL} **${formatNumber(amount)}**.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('beg').setDescription('Beg for spare coins (5 minute cooldown)'),
    async execute(interaction) {
      const eco = getEco(interaction.guild.id, interaction.user.id);
      const wait = eco.last_beg + 300_000 - Date.now();
      if (wait > 0) return interaction.editReply({ embeds: [fail(`Nobody will listen for another **${formatDuration(wait)}**.`)] });
      if (!chance(0.65))
        return interaction.editReply({ embeds: [fail('Everyone ignored you. (no coins this time)')] });
      const amount = rand(20, 90);
      db.prepare('UPDATE economy SET wallet = wallet + ?, last_beg = ? WHERE guild_id = ? AND user_id = ?')
        .run(amount, Date.now(), interaction.guild.id, interaction.user.id);
      return interaction.editReply({ embeds: [ok(pick(BEG_REPLIES).replace('{amt}', `${SYMBOL} **${amount}**`))] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('pay')
      .setDescription('Send coins to another member')
      .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
      .addIntegerOption((o) => amountOption(o)),
    async execute(interaction) {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      if (target.id === interaction.user.id) return interaction.editReply({ embeds: [fail('You cannot pay yourself.')] });
      if (target.bot) return interaction.editReply({ embeds: [fail('Bots have no use for coins.')] });

      const from = getEco(interaction.guild.id, interaction.user.id);
      if (from.wallet < amount) return interaction.editReply({ embeds: [fail(`You only have ${SYMBOL} **${formatNumber(from.wallet)}** in your wallet.`)] });

      const transfer = db.transaction(() => {
        db.prepare('UPDATE economy SET wallet = wallet - ? WHERE guild_id = ? AND user_id = ?').run(amount, interaction.guild.id, interaction.user.id);
        ensure(interaction.guild.id, target.id);
        db.prepare('UPDATE economy SET wallet = wallet + ? WHERE guild_id = ? AND user_id = ?').run(amount, interaction.guild.id, target.id);
      });
      transfer();

      return interaction.editReply({
        embeds: [ok(`💸 You sent ${SYMBOL} **${formatNumber(amount)}** to ${target}.`)],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('gamble')
      .setDescription('Bet your coins — 48% chance to double')
      .addIntegerOption((o) => amountOption(o)),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      const eco = getEco(interaction.guild.id, interaction.user.id);
      if (eco.wallet < amount) return interaction.editReply({ embeds: [fail('You do not have that many coins in your wallet.')] });

      const win = chance(0.48);
      const delta = win ? amount : -amount;
      db.prepare('UPDATE economy SET wallet = wallet + ? WHERE guild_id = ? AND user_id = ?').run(delta, interaction.guild.id, interaction.user.id);
      const after = eco.wallet + delta;

      return interaction.editReply({
        embeds: [
          embed({
            title: win ? '🎰 You won!' : '🎰 You lost',
            description: `${win ? `You won ${SYMBOL} **${formatNumber(amount)}**` : `You lost ${SYMBOL} **${formatNumber(amount)}**`}.\nWallet: ${SYMBOL} ${formatNumber(after)}`,
            color: win ? C.ok : C.error,
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('slots')
      .setDescription('Spin the slot machine')
      .addIntegerOption((o) => amountOption(o)),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      const eco = getEco(interaction.guild.id, interaction.user.id);
      if (eco.wallet < amount) return interaction.editReply({ embeds: [fail('You do not have that many coins in your wallet.')] });

      const rolls = [pick(SLOT_ITEMS), pick(SLOT_ITEMS), pick(SLOT_ITEMS)];
      const unique = new Set(rolls).size;
      let delta = -amount;
      let verdict = 'No match — you lost.';
      let color = C.error;

      if (unique === 1) {
        delta = amount * 9;
        verdict = '💥 JACKPOT! Triple match — 9x payout.';
        color = C.ok;
      } else if (unique === 2) {
        delta = Math.floor(amount * 0.5);
        verdict = 'Two matched — 50% returned.';
        color = C.warn;
      }

      db.prepare('UPDATE economy SET wallet = wallet + ? WHERE guild_id = ? AND user_id = ?').run(delta, interaction.guild.id, interaction.user.id);
      return interaction.editReply({
        embeds: [
          embed({
            title: `［ ${rolls.join(' │ ')} ］`,
            description: `${verdict}\nWallet: ${SYMBOL} ${formatNumber(eco.wallet + delta)}`,
            color,
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rob')
      .setDescription('Try to steal coins from someone’s wallet')
      .addUserOption((o) => o.setName('user').setDescription('Target').setRequired(true)),
    async execute(interaction) {
      const target = interaction.options.getUser('user');
      if (target.id === interaction.user.id) return interaction.editReply({ embeds: [fail('Robbing yourself is just banking with extra steps.')] });
      if (target.bot) return interaction.editReply({ embeds: [fail('You cannot rob a bot.')] });

      const robber = getEco(interaction.guild.id, interaction.user.id);
      const wait = robber.last_rob + HOUR - Date.now();
      if (wait > 0) return interaction.editReply({ embeds: [fail(`Keep a low profile for **${formatDuration(wait)}**.`)] });

      const victim = getEco(interaction.guild.id, target.id);
      db.prepare('UPDATE economy SET last_rob = ? WHERE guild_id = ? AND user_id = ?').run(Date.now(), interaction.guild.id, interaction.user.id);

      if (victim.wallet < 100)
        return interaction.editReply({ embeds: [fail(`${target.username} has less than ${SYMBOL} 100 in their wallet. Not worth it.`)] });

      if (chance(0.4)) {
        const take = Math.max(50, Math.floor(victim.wallet * (0.15 + Math.random() * 0.2)));
        db.transaction(() => {
          db.prepare('UPDATE economy SET wallet = wallet - ? WHERE guild_id = ? AND user_id = ?').run(take, interaction.guild.id, target.id);
          db.prepare('UPDATE economy SET wallet = wallet + ? WHERE guild_id = ? AND user_id = ?').run(take, interaction.guild.id, interaction.user.id);
        })();
        return interaction.editReply({ embeds: [ok(`🥷 You robbed ${target} for ${SYMBOL} **${formatNumber(take)}**!`)] });
      }

      const fine = Math.min(robber.wallet, rand(100, 300));
      db.prepare('UPDATE economy SET wallet = wallet - ? WHERE guild_id = ? AND user_id = ?').run(fine, interaction.guild.id, interaction.user.id);
      return interaction.editReply({ embeds: [fail(`You got caught and paid a ${SYMBOL} **${formatNumber(fine)}** fine.`)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('ecoboard').setDescription('Richest members in the server'),
    async execute(interaction) {
      const rows = db
        .prepare('SELECT user_id, wallet + bank AS net FROM economy WHERE guild_id = ? ORDER BY net DESC LIMIT 15')
        .all(interaction.guild.id);
      if (!rows.length) return interaction.editReply({ embeds: [fail('Nobody has any coins yet — try `/daily`.')] });

      const members = await interaction.guild.members.fetch({ user: rows.map((r) => r.user_id) }).catch(() => null);
      const medals = ['🥇', '🥈', '🥉'];
      const description = rows
        .map((r, i) => `${medals[i] ?? `**${i + 1}.**`} ${members?.get(r.user_id)?.displayName ?? `<@${r.user_id}>`} — ${SYMBOL} ${formatNumber(r.net)}`)
        .join('\n');

      return interaction.editReply({ embeds: [embed({ title: '💰 Economy leaderboard', description, color: C.warn })] });
    },
  },
];

export default { category, commands };
