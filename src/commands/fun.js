import { SlashCommandBuilder, ButtonStyle } from 'discord.js';
import { embed, ok, fail, C, row, btn, EPH } from '../lib/ui.js';
import { pick, rand, shuffle, fetchJson, truncate, chance } from '../lib/helpers.js';

const category = 'Fun';

const EIGHT_BALL = [
  'It is certain.', 'Without a doubt.', 'Yes — definitely.', 'You may rely on it.',
  'Most likely.', 'Outlook good.', 'Signs point to yes.', 'Reply hazy, try again.',
  'Ask again later.', 'Better not tell you now.', 'Cannot predict now.',
  'Concentrate and ask again.', 'Do not count on it.', "My reply is no.",
  'My sources say no.', 'Outlook not so good.', 'Very doubtful.',
];

const ROASTS = [
  'Your keyboard called. It wants a break from all that backspacing.',
  'You bring everyone so much joy… when you leave the room.',
  'You are the human equivalent of a pop-up ad.',
  'Your secrets are safe with me. I never listen anyway.',
  'You have something on your chin. No, the third one down.',
  'You are proof that even the worst gamers get a rank.',
  'Your Discord tag is the best thing about your message history.',
  'You type like autocorrect gave up and went home.',
];

const COMPLIMENTS = [
  'You make this server better just by showing up.',
  'Your taste in music is genuinely excellent.',
  'You explain things better than most documentation.',
  'You have a great laugh and everyone notices it.',
  'You are the reason people keep coming back here.',
  'You give off main-character energy in the best way.',
  'Your ideas are consistently the most interesting ones in the chat.',
];

const WYR = [
  ['have unlimited free coffee for life', 'never need sleep again'],
  ['always be 10 minutes early', 'always be able to teleport anywhere'],
  ['only listen to one album forever', 'only watch one film forever'],
  ['be famous for something silly', 'be rich and completely anonymous'],
  ['never lose a game again', 'never have to wait in a queue again'],
  ['read minds but cannot turn it off', 'become invisible but only for 10 seconds'],
];

const TRUTHS = [
  'What is the most embarrassing song in your playlist?',
  'What is the last lie you told?',
  'What is your most useless talent?',
  'Who in this server would you swap lives with for a day?',
  'What is the longest you have stayed awake?',
];

const DARES = [
  'Type your next five messages in all caps.',
  'Change your nickname to something embarrassing for 10 minutes.',
  'Send the most recent meme in your saved folder.',
  'Write a four line poem about the last person who messaged here.',
  'Speak only in emojis for your next five messages.',
];

const coins = (n) => `🪙 ${n}`;

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('8ball')
      .setDescription('Ask the magic 8-ball')
      .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(300)),
    async execute(interaction) {
      const q = interaction.options.getString('question');
      return interaction.editReply({
        embeds: [embed({ title: '🎱 The 8-ball says…', description: `> ${q}\n\n**${pick(EIGHT_BALL)}**`, color: 0x2c2f33 })],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin'),
    async execute(interaction) {
      return interaction.editReply({ embeds: [embed({ title: `🪙 ${pick(['Heads', 'Tails'])}!`, color: C.warn })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('dice')
      .setDescription('Roll dice')
      .addIntegerOption((o) => o.setName('sides').setDescription('Sides per die (default 6)').setMinValue(2).setMaxValue(1000))
      .addIntegerOption((o) => o.setName('count').setDescription('Number of dice (default 1)').setMinValue(1).setMaxValue(20)),
    async execute(interaction) {
      const sides = interaction.options.getInteger('sides') ?? 6;
      const count = interaction.options.getInteger('count') ?? 1;
      const rolls = Array.from({ length: count }, () => rand(1, sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      return interaction.editReply({
        embeds: [
          embed({
            title: `🎲 ${count}d${sides}`,
            description: `**${rolls.join(' + ')}**${count > 1 ? ` = **${total}**` : ''}`,
            color: C.brand,
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rps')
      .setDescription('Rock paper scissors')
      .addStringOption((o) =>
        o
          .setName('choice')
          .setDescription('Your pick')
          .setRequired(true)
          .addChoices(
            { name: 'Rock', value: 'rock' },
            { name: 'Paper', value: 'paper' },
            { name: 'Scissors', value: 'scissors' },
          ),
      ),
    async execute(interaction) {
      const mine = interaction.options.getString('choice');
      const theirs = pick(['rock', 'paper', 'scissors']);
      const icons = { rock: '🪨', paper: '📄', scissors: '✂️' };
      const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
      const result = mine === theirs ? '🤝 It’s a tie!' : beats[mine] === theirs ? '🎉 You win!' : '😈 I win!';
      return interaction.editReply({
        embeds: [embed({ title: `${icons[mine]} vs ${icons[theirs]}`, description: `You: **${mine}**\nMe: **${theirs}**\n\n${result}`, color: C.brand })],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('trivia').setDescription('Answer a multiple choice trivia question'),
    async execute(interaction) {
      const data = await fetchJson('https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986').catch(() => null);
      const q = data?.results?.[0];
      if (!q) return interaction.editReply({ embeds: [fail('Trivia API is busy, try again in a moment.')] });

      const decode = (s) => decodeURIComponent(s ?? '');
      const correct = decode(q.correct_answer);
      const answers = shuffle([correct, ...q.incorrect_answers.map(decode)]);
      const correctIndex = answers.indexOf(correct);

      return interaction.editReply({
        embeds: [
          embed({
            title: '🧠 Trivia',
            description: `**${decode(q.question)}**\n\nPick an answer below — first correct answer wins.`,
            color: C.brand,
            footer: { text: `${decode(q.category)} • ${decode(q.difficulty)}` },
          }),
        ],
        components: [row(...answers.map((a, i) => btn.secondary(`trivia:${correctIndex}:${i}`, truncate(a, 78))))],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('joke').setDescription('Tell a random joke'),
    async execute(interaction) {
      const data = await fetchJson('https://official-joke-api.appspot.com/random_joke').catch(() => null);
      if (!data?.setup) return interaction.editReply({ embeds: [fail('Joke API is down, sorry.')] });
      return interaction.editReply({
        embeds: [embed({ title: '😂', description: `${data.setup}\n||${data.punchline}||`, color: C.warn })],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('meme').setDescription('Random meme from Reddit'),
    async execute(interaction) {
      const data = await fetchJson('https://meme-api.com/gimme').catch(() => null);
      if (!data?.url) return interaction.editReply({ embeds: [fail('Meme API is down, sorry.')] });
      return interaction.editReply({
        embeds: [
          embed({
            title: truncate(data.title, 250),
            url: data.postLink,
            image: data.url,
            color: C.warn,
            footer: { text: `r/${data.subreddit} • 👍 ${data.ups}` },
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('animal')
      .setDescription('Random animal pictures')
      .addSubcommand((s) => s.setName('cat').setDescription('Random cat picture'))
      .addSubcommand((s) => s.setName('dog').setDescription('Random dog picture')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'cat') {
        const data = await fetchJson('https://api.thecatapi.com/v1/images/search').catch(() => null);
        const url = data?.[0]?.url;
        if (!url) return interaction.editReply({ embeds: [fail('Cat API is down, sorry.')] });
        return interaction.editReply({ embeds: [embed({ title: '🐱 Meow', image: url, color: C.warn })] });
      }
      const data = await fetchJson('https://dog.ceo/api/breeds/image/random').catch(() => null);
      if (!data?.message) return interaction.editReply({ embeds: [fail('Dog API is down, sorry.')] });
      return interaction.editReply({ embeds: [embed({ title: '🐶 Woof', image: data.message, color: C.warn })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('choose')
      .setDescription('Let the bot decide between options')
      .addStringOption((o) => o.setName('options').setDescription('Separate with commas').setRequired(true).setMaxLength(800)),
    async execute(interaction) {
      const options = interaction.options
        .getString('options')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (options.length < 2) return interaction.editReply({ embeds: [fail('Give me at least two options separated by commas.')] });
      return interaction.editReply({ embeds: [embed({ title: '🤔 I choose…', description: `**${pick(options)}**`, color: C.brand })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('ship')
      .setDescription('Compatibility meter between two members')
      .addUserOption((o) => o.setName('user1').setDescription('First member').setRequired(true))
      .addUserOption((o) => o.setName('user2').setDescription('Second member').setRequired(true)),
    async execute(interaction) {
      const a = interaction.options.getUser('user1');
      const b = interaction.options.getUser('user2');
      const seed = [a.id, b.id].sort().join('');
      let hash = 0;
      for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 101;
      const filled = Math.round(hash / 10);
      const bar = '❤️'.repeat(filled) + '🖤'.repeat(10 - filled);
      return interaction.editReply({
        embeds: [
          embed({
            title: '💘 Compatibility',
            description: `${a} + ${b}\n\n${bar}\n**${hash}%**`,
            color: hash > 60 ? C.ok : hash > 30 ? C.warn : C.error,
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roast')
      .setDescription('Playfully roast a member')
      .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') ?? interaction.user;
      return interaction.editReply({ embeds: [embed({ description: `${user} ${pick(ROASTS)}`, color: C.error })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('compliment')
      .setDescription('Say something nice to a member')
      .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') ?? interaction.user;
      return interaction.editReply({ embeds: [embed({ description: `${user} ${pick(COMPLIMENTS)}`, color: C.ok })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('game')
      .setDescription('Would you rather, or truth and dare')
      .addSubcommand((s) => s.setName('wouldyourather').setDescription('Would you rather…'))
      .addSubcommand((s) =>
        s
          .setName('truthordare')
          .setDescription('Truth or dare')
          .addStringOption((o) =>
            o.setName('type').setDescription('Pick one').setRequired(true)
              .addChoices({ name: 'Truth', value: 'truth' }, { name: 'Dare', value: 'dare' }),
          ),
      ),
    async execute(interaction) {
      if (interaction.options.getSubcommand() === 'wouldyourather') {
        const [a, b] = pick(WYR);
        return interaction.editReply({
          embeds: [embed({ title: '🤷 Would you rather…', description: `🇦 ${a}\n\n**or**\n\n🇧 ${b}`, color: C.brand })],
          components: [row(btn.primary('wyr:a', 'Option A', '🇦'), btn.primary('wyr:b', 'Option B', '🇧'))],
        });
      }
      const type = interaction.options.getString('type');
      const text = type === 'truth' ? pick(TRUTHS) : pick(DARES);
      return interaction.editReply({
        embeds: [embed({ title: type === 'truth' ? '🫢 Truth' : '😈 Dare', description: text, color: type === 'truth' ? C.brand : C.error })],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rate')
      .setDescription('Silly random meters')
      .addSubcommand((s) =>
        s.setName('iq').setDescription('Totally scientific IQ test')
          .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
      )
      .addSubcommand((s) =>
        s.setName('chaos').setDescription('Random chaos percentage')
          .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
      )
      .addSubcommand((s) =>
        s.setName('gay').setDescription('Random rainbow meter')
          .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser('user') ?? interaction.user;
      if (sub === 'iq') return interaction.editReply({ embeds: [embed({ description: `${user} has an IQ of **${rand(60, 160)}** 🧠`, color: C.brand })] });
      if (sub === 'gay') return interaction.editReply({ embeds: [embed({ description: `${user} is **${rand(0, 100)}%** 🌈`, color: C.brand })] });
      return interaction.editReply({ embeds: [embed({ description: `${user} is **${rand(0, 100)}%** chaotic 🌪️`, color: C.brand })] });
    },
  },
];

const components = {
  async trivia(interaction, args) {
    const [correctIndex, chosen] = args;
    if (correctIndex === 'done') {
      return interaction.reply({ content: 'This trivia round is already over — run `/trivia` for a new one.', flags: EPH });
    }
    const buttons = interaction.message.components[0].components.map((b, i) => {
      const clone = btn.secondary(`trivia:done:${i}`, b.label, null);
      clone.setDisabled(true);
      if (i === Number(correctIndex)) clone.setStyle(ButtonStyle.Success);
      if (i === Number(chosen) && chosen !== correctIndex) clone.setStyle(ButtonStyle.Danger);
      return clone;
    });
    const win = chosen === correctIndex;
    return interaction.update({
      embeds: [
        embed({
          title: win ? '✅ Correct!' : '❌ Wrong',
          description: `${interaction.user} picked **${buttons[Number(chosen)].data.label}**`,
          color: win ? C.ok : C.error,
        }),
      ],
      components: [row(...buttons)],
    });
  },
  async wyr(interaction, args) {
    const picked = args[0] === 'a' ? 'A' : 'B';
    return interaction.reply({ content: `You picked **${picked}** — noted.`, flags: EPH });
  },
};

export default { category, commands, components };
