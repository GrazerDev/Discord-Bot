import {
  SlashCommandBuilder,
  PermissionFlagsBits as P,
  ChannelType,
  version as djsVersion,
} from 'discord.js';
import { config } from '../config.js';
import { db, getGuild } from '../db.js';
import { embed, ok, fail, info, field, C, row, selectMenu, EPH } from '../lib/ui.js';
import {
  formatNumber,
  timestamp,
  snowflakeTime,
  formatDuration,
  parseDuration,
  truncate,
  fetchJson,
} from '../lib/helpers.js';
import { snipes, editSnipes } from '../lib/cache.js';

const category = 'Utility';

/** The registry is attached to the client by index.js (avoids circular imports). */
const appCommands = (interaction) => [...interaction.client.commands.values()];

const CATEGORIES = ['Moderation', 'Configuration', 'Levels', 'Economy', 'Music', 'Tickets', 'Giveaways', 'Roles', 'Social', 'Utility', 'Fun', 'Tags', 'Reminders', 'Context'];

function helpEmbed(source, categoryName = null) {
  const list = source ?? [];
  const filtered = list.filter((c) => c.data.name && (!categoryName || c.category === categoryName));
  const groups = {};
  for (const cmd of filtered) {
    const isMenu = cmd.data.type === 2 || cmd.data.type === 3;
    (groups[cmd.category ?? 'Other'] ??= []).push(isMenu ? `\`[${cmd.data.name}]\`` : `\`/${cmd.data.name}\``);
  }

  const fields = Object.entries(groups).map(([name, list]) => ({
    name: `${name} (${list.length})`,
    value: list.sort().join(' '),
    inline: false,
  }));

  return embed({
    title: categoryName ? `📖 ${categoryName} commands` : '📖 Nexus — command reference',
    color: C.brand,
    description: categoryName
      ? undefined
      : `**${list.length}** slash commands and context menus.\nUse the menu below to browse, or run \`/help <command>\` for details on one command.`,
    fields,
    footer: { text: 'Nexus • built for Cloudflare-free hosting 🚀' },
  });
}

const commands = [
  /* HELP ─────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('List every command, or get details on one')
      .addStringOption((o) => o.setName('command').setDescription('Specific command').setAutocomplete(true)),
    async execute(interaction) {
      const name = interaction.options.getString('command');
      if (name) {
        const cmd = appCommands(interaction).find((c) => c.data.name === name);
        if (!cmd) return interaction.editReply({ embeds: [fail(`No command called \`${name}\`.`)] });
        const json = cmd.data.toJSON ? cmd.data.toJSON() : cmd.data;
        const subcommands = (json.options ?? []).filter((o) => o.type === 1 || o.type === 2).map((o) => `\`${o.name}\``);
        return interaction.editReply({
          embeds: [
            embed({
              title: `/${json.name}`,
              description: json.description,
              color: C.brand,
              fields: [
                ...(subcommands.length ? [{ name: 'Subcommands', value: subcommands.join(' '), inline: false }] : []),
                { name: 'Category', value: cmd.category ?? 'Other', inline: true },
                { name: 'Permissions', value: json.default_member_permissions ? `<@&${json.default_member_permissions}>` : 'Everyone', inline: true },
              ],
            }),
          ],
        });
      }

      const menu = selectMenu({
        id: 'help:category',
        placeholder: 'Browse a category…',
        options: CATEGORIES.map((c) => ({ label: c, value: c, emoji: '📁' })),
      });
      return interaction.editReply({ embeds: [helpEmbed(appCommands(interaction))], components: [menu] });
    },
    async autocomplete(interaction) {
      const focused = interaction.options.getFocused().toLowerCase();
      const matches = appCommands(interaction)
        .filter((c) => c.data.name?.includes(focused))
        .slice(0, 25)
        .map((c) => ({ name: `/${c.data.name} — ${truncate(c.data.description ?? '', 60)}`, value: c.data.name }));
      await interaction.respond(matches);
    },
  },

  /* PING ─────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
    async execute(interaction) {
      const sent = Date.now();
      await interaction.editReply({ embeds: [embed({ title: 'Pinging…', color: C.muted })] });
      const roundtrip = Date.now() - sent;
      return interaction.editReply({
        embeds: [
          embed({
            title: '🏓 Pong!',
            color: C.ok,
            fields: [
              field('Websocket', `${Math.round(interaction.client.ws.ping)}ms`),
              field('Round trip', `${roundtrip}ms`),
              field('Uptime', formatDuration(interaction.client.uptime)),
            ],
          }),
        ],
      });
    },
  },

  /* USERINFO ─────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Detailed information about a member')
      .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      const keys = member
        ? [...member.roles.cache.values()]
            .filter((r) => r.id !== interaction.guild.id)
            .sort((a, b) => b.position - a.position)
            .map((r) => `${r}`)
        : [];

      const eco = db.prepare('SELECT wallet, bank FROM economy WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, user.id);
      const lvl = db.prepare('SELECT xp FROM levels WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, user.id);

      return interaction.editReply({
        embeds: [
          embed({
            title: `${user.username}`,
            color: member?.displayColor || C.brand,
            thumbnail: user.displayAvatarURL({ size: 512 }),
            fields: [
              field('Username', user.tag),
              field('ID', `\`${user.id}\``),
              field('Bot', user.bot ? 'Yes' : 'No'),
              field('Created', `${timestamp(user.createdTimestamp, 'D')} (${timestamp(user.createdTimestamp)})`, false),
              ...(member
                ? [
                    field('Joined', `${timestamp(member.joinedTimestamp, 'D')} (${timestamp(member.joinedTimestamp)})`, false),
                    field('Nickname', member.nickname ?? '—'),
                    field('Top role', `${member.roles.highest}`),
                    field('Roles', keys.length ? truncate(keys.join(' '), 1000) : 'None', false),
                  ]
                : []),
              ...(eco ? [field('Coins', formatNumber(eco.wallet + eco.bank))] : []),
              ...(lvl ? [field('XP', formatNumber(lvl.xp))] : []),
            ],
          }),
        ],
      });
    },
  },

  /* AVATAR / BANNER ──────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('Show a member’s avatar or profile banner')
      .addSubcommand((s) =>
        s.setName('avatar').setDescription('Show an avatar')
          .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
      )
      .addSubcommand((s) =>
        s.setName('banner').setDescription('Show a profile banner')
          .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const user = await interaction.client.users.fetch(interaction.options.getUser('user') ?? interaction.user, { force: true });

      if (sub === 'banner') {
        const url = user.bannerURL({ size: 1024 });
        if (!url) return interaction.editReply({ embeds: [fail('That user has no banner.')] });
        return interaction.editReply({ embeds: [embed({ title: `${user.username}’s banner`, image: url, color: C.brand })] });
      }

      return interaction.editReply({
        embeds: [
          embed({
            title: `${user.username}’s avatar`,
            image: user.displayAvatarURL({ size: 1024 }),
            color: C.brand,
            fields: [
              { name: 'PNG', value: `[link](${user.displayAvatarURL({ extension: 'png', size: 1024 })})`, inline: true },
              { name: 'WEBP', value: `[link](${user.displayAvatarURL({ extension: 'webp', size: 1024 })})`, inline: true },
              ...(user.avatar?.startsWith('a_')
                ? [{ name: 'GIF', value: `[link](${user.displayAvatarURL({ extension: 'gif', size: 1024 })})`, inline: true }]
                : []),
            ],
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('Information about this server'),
    async execute(interaction) {
      const guild = interaction.guild;
      const owner = await guild.fetchOwner().catch(() => null);
      const channels = guild.channels.cache;
      const bots = guild.members.cache.filter((m) => m.user.bot).size;

      return interaction.editReply({
        embeds: [
          embed({
            title: guild.name,
            color: C.brand,
            thumbnail: guild.iconURL({ size: 512 }),
            image: guild.bannerURL({ size: 1024 }) ?? undefined,
            fields: [
              field('Owner', owner ? `${owner.user.tag}` : '—'),
              field('ID', `\`${guild.id}\``),
              field('Created', `${timestamp(guild.createdTimestamp, 'D')} (${timestamp(guild.createdTimestamp)})`, false),
              field('Members', formatNumber(guild.memberCount)),
              field('Bots', formatNumber(bots)),
              field('Boost level', `Tier ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} boosts)`),
              field('Roles', formatNumber(guild.roles.cache.size)),
              field('Text channels', formatNumber(channels.filter((c) => c.type === ChannelType.GuildText).size)),
              field('Voice channels', formatNumber(channels.filter((c) => c.type === ChannelType.GuildVoice).size)),
              field('Emojis', formatNumber(guild.emojis.cache.size)),
              field('Verification', `${guild.verificationLevel}`),
            ],
          }),
        ],
      });
    },
  },

  /* ROLEINFO ─────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('roleinfo')
      .setDescription('Information about a role')
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    async execute(interaction) {
      const role = interaction.options.getRole('role');
      return interaction.editReply({
        embeds: [
          embed({
            title: role.name,
            color: role.color || C.brand,
            fields: [
              field('ID', `\`${role.id}\``),
              field('Colour', role.hexColor),
              field('Members', formatNumber(role.members.size)),
              field('Position', `${role.position}`),
              field('Mentionable', role.mentionable ? 'Yes' : 'No'),
              field('Hoisted', role.hoist ? 'Yes' : 'No'),
              field('Managed', role.managed ? 'Yes (integration)' : 'No'),
              field('Created', `${timestamp(role.createdTimestamp, 'D')} (${timestamp(role.createdTimestamp)})`, false),
              field('Permissions', truncate(role.permissions.toArray().map((p) => `\`${p}\``).join(' ') || 'None', 1000), false),
            ],
          }),
        ],
      });
    },
  },

  /* CHANNELINFO ──────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('channelinfo')
      .setDescription('Information about a channel')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel (defaults to this one)')),
    async execute(interaction) {
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      const fields = [
        field('ID', `\`${channel.id}\``),
        field('Type', `${channel.type}`),
        field('Created', `${timestamp(channel.createdTimestamp, 'D')} (${timestamp(channel.createdTimestamp)})`, false),
      ];
      if (channel.isTextBased?.()) fields.push(field('Topic', channel.topic ? truncate(channel.topic, 400) : '—', false));
      if ('rateLimitPerUser' in channel) fields.push(field('Slowmode', channel.rateLimitPerUser ? formatDuration(channel.rateLimitPerUser * 1000) : 'Off'));
      if (channel.isVoiceBased?.()) fields.push(field('Members connected', `${channel.members.size}`));
      return interaction.editReply({ embeds: [embed({ title: `#${channel.name}`, color: C.brand, fields })] });
    },
  },

  /* EMOJIS ───────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('emojis')
      .setDescription('List this server’s custom emojis')
      .setDMPermission(false),
    async execute(interaction) {
      const emojis = [...interaction.guild.emojis.cache.values()];
      if (!emojis.length) return interaction.editReply({ embeds: [fail('This server has no custom emojis.')] });
      const list = emojis.slice(0, 60).map((e) => `${e} \`:${e.name}:\``).join('\n');
      return interaction.editReply({
        embeds: [embed({ title: `Emojis (${emojis.length})`, description: list, color: C.brand })],
      });
    },
  },

  /* INVITE / BOTINFO ─────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('botinfo')
      .setDescription('Bot statistics and invite link')
      .addSubcommand((s) => s.setName('info').setDescription('Stats about the bot'))
      .addSubcommand((s) => s.setName('invite').setDescription('Get the invite link for this bot')),
    async execute(interaction) {
      if (interaction.options.getSubcommand() === 'invite') {
        const url = `https://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=8&scope=bot%20applications.commands`;
        return interaction.editReply({ embeds: [embed({ title: '🔗 Invite me', description: `[Click here to add the bot](${url})`, color: C.brand })] });
      }

      const client = interaction.client;
      const mem = process.memoryUsage();
      return interaction.editReply({
        embeds: [
          embed({
            title: '🤖 Nexus',
            color: C.brand,
            thumbnail: client.user.displayAvatarURL({ size: 256 }),
            fields: [
              field('Servers', formatNumber(client.guilds.cache.size)),
              field('Users', formatNumber(client.guilds.cache.reduce((a, g) => a + g.memberCount, 0))),
              field('Channels', formatNumber(client.channels.cache.size)),
              field('Commands', formatNumber(client.commands.size)),
              field('Uptime', formatDuration(client.uptime)),
              field('Ping', `${Math.round(client.ws.ping)}ms`),
              field('Memory', `${Math.round(mem.heapUsed / 1024 / 1024)} MB`),
              field('Node', process.version),
              field('discord.js', `v${djsVersion}`),
            ],
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('afk')
      .setDescription('Set an AFK status — the bot tells people who ping you')
      .addStringOption((o) => o.setName('reason').setDescription('Why you are away').setMaxLength(200)),
    async execute(interaction) {
      const reason = interaction.options.getString('reason') ?? 'AFK';
      db.prepare('INSERT INTO afk (guild_id, user_id, status, since) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET status = excluded.status, since = excluded.since')
        .run(interaction.guild.id, interaction.user.id, reason, Date.now());
      await interaction.guild.members.me.setNickname(null).catch(() => {});
      return interaction.editReply({ embeds: [ok(`You are now AFK: **${reason}**\nI will let people know when they mention you.`)] });
    },
  },

  /* SNIPE ────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('snipe')
      .setDescription('Recover the last deleted or edited message here')
      .addSubcommand((s) => s.setName('delete').setDescription('Last deleted message'))
      .addSubcommand((s) => s.setName('edit').setDescription('Last edited message')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'delete') {
        const snipe = snipes.get(interaction.channel.id);
        if (!snipe) return interaction.editReply({ embeds: [fail('Nothing to snipe in this channel.')] });
        return interaction.editReply({
          embeds: [
            embed({
              author: { name: `Deleted • ${snipe.author}`, icon_url: snipe.avatar ?? undefined },
              description: truncate(snipe.content || '*no text*', 2000),
              color: C.error,
              footer: { text: `${snipe.attachments} attachment(s) • ${timestamp(snipe.createdAt)}` },
            }),
          ],
        });
      }

      const snipe = editSnipes.get(interaction.channel.id);
      if (!snipe) return interaction.editReply({ embeds: [fail('Nothing to snipe in this channel.')] });
      return interaction.editReply({
        embeds: [
          embed({
            author: { name: `Edited • ${snipe.author}` },
            color: C.warn,
            fields: [
              { name: 'Before', value: truncate(snipe.before || '*empty*', 1000) },
              { name: 'After', value: truncate(snipe.after || '*empty*', 1000) },
            ],
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('timestamp')
      .setDescription('Generate Discord timestamps from a date or relative time')
      .addStringOption((o) => o.setName('when').setDescription('e.g. 2026-12-25 18:00, or 2h, 3d').setRequired(true)),
    async execute(interaction) {
      const input = interaction.options.getString('when').trim();
      let ms = Date.parse(input);
      if (Number.isNaN(ms)) {
        const dur = parseDuration(input);
        if (dur) ms = Date.now() + dur;
      }
      if (Number.isNaN(ms) || !ms) return interaction.editReply({ embeds: [fail('Could not parse that. Try `2026-12-25 18:00` or `2h`.')] });
      const styles = { t: 'Short time', T: 'Long time', d: 'Short date', D: 'Long date', f: 'Short date/time', F: 'Long date/time', R: 'Relative' };
      return interaction.editReply({
        embeds: [
          embed({
            title: '🕒 Timestamps',
            color: C.brand,
            description: Object.entries(styles).map(([k, label]) => `${label}: \`${timestamp(ms, k)}\` → ${timestamp(ms, k)}`).join('\n'),
            footer: { text: `Unix: ${Math.floor(ms / 1000)}` },
          }),
        ],
      });
    },
  },

  /* WEATHER ──────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('weather')
      .setDescription('Current weather and a 3 day forecast for a place')
      .addStringOption((o) => o.setName('place').setDescription('City name').setRequired(true).setMaxLength(80)),
    async execute(interaction) {
      const place = interaction.options.getString('place');
      const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`);
      const loc = geo.results?.[0];
      if (!loc) return interaction.editReply({ embeds: [fail(`Could not find **${place}**.`)] });

      const data = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
          '&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code' +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto',
      );
      const c = data.current;
      const days = data.daily.time.map((d, i) => `${timestamp(Date.parse(d), 'D')} — ${data.daily.temperature_2m_min[i]}° / ${data.daily.temperature_2m_max[i]}°`).join('\n');

      return interaction.editReply({
        embeds: [
          embed({
            title: `🌤️ ${loc.name}, ${loc.country ?? ''}`.trim(),
            color: C.brand,
            description: `**${c.temperature_2m}°C** (feels like ${c.apparent_temperature}°C)\nHumidity ${c.relative_humidity_2m}% • Wind ${c.wind_speed_10m} km/h`,
            fields: [{ name: 'Next 3 days', value: days, inline: false }],
            footer: { text: 'Data: open-meteo.com' },
          }),
        ],
      });
    },
  },

  /* DEFINE / URBAN ──────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('dictionary')
      .setDescription('Look words up')
      .addSubcommand((s) =>
        s.setName('define').setDescription('Standard dictionary definition')
          .addStringOption((o) => o.setName('word').setDescription('Word').setRequired(true).setMaxLength(60)),
      )
      .addSubcommand((s) =>
        s.setName('urban').setDescription('Urban Dictionary lookup')
          .addStringOption((o) => o.setName('term').setDescription('Term').setRequired(true).setMaxLength(100)),
      ),
    async execute(interaction) {
      if (interaction.options.getSubcommand() === 'define') {
        const word = interaction.options.getString('word');
        const data = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`).catch(() => null);
        const entry = Array.isArray(data) ? data[0] : null;
        if (!entry) return interaction.editReply({ embeds: [fail(`No definition found for **${word}**.`)] });

        const fields = entry.meanings.slice(0, 4).map((meaning) => ({
          name: `${meaning.partOfSpeech} (${meaning.definitions.length})`,
          value: truncate(meaning.definitions.map((d, i) => `${i + 1}. ${d.definition}`).join('\n'), 900),
          inline: false,
        }));
        return interaction.editReply({
          embeds: [embed({ title: `📚 ${entry.word}`, color: C.brand, fields, footer: entry.phonetic ?? undefined })],
        });
      }

      const term = interaction.options.getString('term');
      const data = await fetchJson(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`).catch(() => null);
      const entry = data?.list?.sort((a, b) => b.thumbs_up - a.thumbs_up)[0];
      if (!entry) return interaction.editReply({ embeds: [fail(`No definition for **${term}**.`)] });
      const clean = (t = '') => t.replace(/[[\]]/g, '').slice(0, 900);
      return interaction.editReply({
        embeds: [
          embed({
            title: truncate(entry.word, 250),
            url: entry.permalink,
            description: clean(entry.definition),
            color: 0x1d2439,
            fields: [{ name: 'Example', value: clean(entry.example) || '—', inline: false }],
            footer: { text: `👍 ${entry.thumbs_up} • 👎 ${entry.thumbs_down}` },
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('github')
      .setDescription('Look up a GitHub user or repository')
      .addStringOption((o) => o.setName('repo').setDescription('user/repo, or just a username').setRequired(true).setMaxLength(120)),
    async execute(interaction) {
      const input = interaction.options.getString('repo');
      const isRepo = input.includes('/');
      const url = isRepo ? `https://api.github.com/repos/${input}` : `https://api.github.com/users/${input}`;
      const data = await fetchJson(url).catch(() => null);
      if (!data || data.message) return interaction.editReply({ embeds: [fail('Not found on GitHub.')] });

      if (isRepo) {
        return interaction.editReply({
          embeds: [
            embed({
              title: data.full_name,
              url: data.html_url,
              color: C.brand,
              description: truncate(data.description ?? '*No description*', 500),
              thumbnail: data.owner?.avatar_url,
              fields: [
                field('Stars', formatNumber(data.stargazers_count)),
                field('Forks', formatNumber(data.forks_count)),
                field('Open issues', formatNumber(data.open_issues_count)),
                field('Language', data.language ?? '—'),
                field('License', data.license?.name ?? 'None'),
                field('Updated', timestamp(Date.parse(data.updated_at), 'R')),
              ],
            }),
          ],
        });
      }

      return interaction.editReply({
        embeds: [
          embed({
            title: data.login,
            url: data.html_url,
            color: C.brand,
            thumbnail: data.avatar_url,
            description: truncate(data.bio ?? '*No bio*', 500),
            fields: [
              field('Repos', formatNumber(data.public_repos)),
              field('Followers', formatNumber(data.followers)),
              field('Following', formatNumber(data.following)),
              field('Joined', timestamp(Date.parse(data.created_at), 'D')),
            ],
          }),
        ],
      });
    },
  },

  /* STATS ────────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Message, command and member activity for this server')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addIntegerOption((o) => o.setName('days').setDescription('How many days (default 7)').setMinValue(1).setMaxValue(30)),
    async execute(interaction) {
      const days = interaction.options.getInteger('days') ?? 7;
      const rows = db
        .prepare('SELECT * FROM stats WHERE guild_id = ? ORDER BY day DESC LIMIT ?')
        .all(interaction.guild.id, days);
      if (!rows.length) return interaction.editReply({ embeds: [fail('No stats recorded yet.')] });

      const totals = rows.reduce(
        (acc, r) => ({
          messages: acc.messages + r.messages,
          joins: acc.joins + r.joins,
          leaves: acc.leaves + r.leaves,
          commands: acc.commands + r.commands,
        }),
        { messages: 0, joins: 0, leaves: 0, commands: 0 },
      );

      return interaction.editReply({
        embeds: [
          embed({
            title: `📊 Last ${rows.length} day(s)`,
            color: C.brand,
            fields: [
              field('Messages', formatNumber(totals.messages)),
              field('Commands used', formatNumber(totals.commands)),
              field('Joins', formatNumber(totals.joins)),
              field('Leaves', formatNumber(totals.leaves)),
              field('Net growth', formatNumber(totals.joins - totals.leaves)),
            ],
          }),
        ],
      });
    },
  },

  /* SEARCH ───────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('search')
      .setDescription('Search this server’s messages in the current channel')
      .setDefaultMemberPermissions(P.ReadMessageHistory)
      .setDMPermission(false)
      .addStringOption((o) => o.setName('query').setDescription('Text to find').setRequired(true).setMaxLength(200))
      .addUserOption((o) => o.setName('user').setDescription('Only from this member'))
      .addIntegerOption((o) => o.setName('limit').setDescription('Messages to scan (max 500)').setMinValue(50).setMaxValue(500)),
    async execute(interaction) {
      const query = interaction.options.getString('query').toLowerCase();
      const user = interaction.options.getUser('user');
      const limit = interaction.options.getInteger('limit') ?? 300;

      let scanned = 0;
      let before;
      const hits = [];
      while (scanned < limit) {
        const batch = await interaction.channel.messages.fetch({ limit: 100, before }).catch(() => null);
        if (!batch?.size) break;
        for (const m of batch.values()) {
          scanned += 1;
          if (user && m.author.id !== user.id) continue;
          if (m.content.toLowerCase().includes(query)) {
            hits.push(`**${m.author.username}**: ${truncate(m.content.replace(/\n/g, ' '), 120)} — [jump](${m.url})`);
            if (hits.length >= 12) break;
          }
        }
        before = batch.last().id;
        if (hits.length >= 12) break;
      }

      if (!hits.length) return interaction.editReply({ embeds: [fail(`No messages containing **${query}** found in the last ${scanned} messages.`)] });
      return interaction.editReply({
        embeds: [embed({ title: `🔎 ${hits.length} result(s)`, description: hits.join('\n'), color: C.brand, footer: { text: `Scanned ${scanned} messages` } })],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('embed')
      .setDescription('Post a custom embed in a channel')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addStringOption((o) => o.setName('description').setDescription('Body text of the embed').setRequired(true).setMaxLength(4000))
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((o) => o.setName('title').setDescription('Embed title').setMaxLength(250))
      .addStringOption((o) => o.setName('color').setDescription('Hex colour, e.g. #5865f2').setMaxLength(20))
      .addStringOption((o) => o.setName('footer').setDescription('Footer text').setMaxLength(200))
      .addStringOption((o) => o.setName('image').setDescription('Large image URL').setMaxLength(500))
      .addStringOption((o) => o.setName('thumbnail').setDescription('Thumbnail URL').setMaxLength(500))
      .addStringOption((o) => o.setName('content').setDescription('Plain text above the embed (mentions work)').setMaxLength(1500))
      .addBooleanOption((o) => o.setName('timestamp').setDescription('Show the current time in the embed')),
    async execute(interaction) {
      const target = interaction.options.getChannel('channel') ?? interaction.channel;
      if (!target?.isTextBased()) return interaction.editReply({ embeds: [fail('Pick a text channel.')] });

      const rawColor = interaction.options.getString('color');
      let color = null;
      if (rawColor) {
        if (rawColor.trim().toLowerCase() === 'random') color = Math.floor(Math.random() * 0xffffff);
        else {
          const m = /^#?([0-9a-fA-F]{6})$/.exec(rawColor.trim());
          if (!m) return interaction.editReply({ embeds: [fail('Colour must be hex like `#5865f2`, or `random`.')] });
          color = parseInt(m[1], 16);
        }
      }

      const isUrl = (v) => /^https?:\/\/\S+$/.test(v ?? '');
      const image = interaction.options.getString('image');
      const thumbnail = interaction.options.getString('thumbnail');
      if (image && !isUrl(image)) return interaction.editReply({ embeds: [fail('`image` must be a full http(s) URL.')] });
      if (thumbnail && !isUrl(thumbnail)) return interaction.editReply({ embeds: [fail('`thumbnail` must be a full http(s) URL.')] });

      const content = interaction.options.getString('content');
      await target.send({
        ...(content ? { content } : {}),
        embeds: [
          embed({
            title: interaction.options.getString('title') ?? undefined,
            description: interaction.options.getString('description'),
            color: color ?? C.brand,
            footer: interaction.options.getString('footer') ?? undefined,
            image: image ?? undefined,
            thumbnail: thumbnail ?? undefined,
            timestamp: interaction.options.getBoolean('timestamp') ?? false,
          }),
        ],
      });

      return interaction.editReply({ embeds: [ok(`Posted in ${target}.`)] });
    },
  },
];

const components = {
  async 'help:category'(interaction) {
    const choice = interaction.values[0];
    const menu = selectMenu({
      id: 'help:category',
      placeholder: 'Browse a category…',
      options: CATEGORIES.map((c) => ({ label: c, value: c, emoji: '📁', default: c === choice })),
    });
    return interaction.update({ embeds: [helpEmbed(appCommands(interaction), choice)], components: [menu] });
  },
};

export default { category, commands, components };
