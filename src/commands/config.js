import { SlashCommandBuilder, PermissionFlagsBits as P, ChannelType } from 'discord.js';
import { getGuild, setGuild, getAutomod, setAutomod, db } from '../db.js';
import { embed, ok, fail, field, C, EPH, row, btn } from '../lib/ui.js';
import { formatDuration } from '../lib/helpers.js';

const category = 'Configuration';

const textChannel = (o, name, description, required = false) =>
  o
    .setName(name)
    .setDescription(description)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setRequired(required);

const fmtChannel = (id) => (id ? `<#${id}>` : '`not set`');
const fmtBool = (v) => (v ? '✅' : '❌');

const AUTOMOD_MODULES = {
  anti_invite: 'Discord invite links',
  anti_link: 'Any URL',
  anti_caps: 'Excessive caps',
  anti_spam: 'Message flooding',
  anti_mention: 'Mass mentions',
  anti_zalgo: 'Zalgo / glitch text',
  anti_newline: 'Newline spam',
};

const commands = [
  /* SETTINGS ─────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('settings')
      .setDescription('Show (or change) this server’s bot configuration')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addChannelOption((o) => textChannel(o, 'suggestions', 'Set the suggestions channel')),
    async execute(interaction) {
      const suggestionsChannel = interaction.options.getChannel('suggestions');
      if (suggestionsChannel) setGuild(interaction.guild.id, { suggestions_channel: suggestionsChannel.id });
      const s = getGuild(interaction.guild.id);
      const a = getAutomod(interaction.guild.id);
      return interaction.editReply({
        embeds: [
          embed({
            title: `⚙️ Settings │ ${interaction.guild.name}`,
            color: C.brand,
            thumbnail: interaction.guild.iconURL(),
            fields: [
              field('Mod log', fmtChannel(s.modlog_channel)),
              field('Message log', fmtChannel(s.msg_log_channel)),
              field('Member log', fmtChannel(s.member_log_channel)),
              field('Voice log', fmtChannel(s.voice_log_channel)),
              field('Server log', fmtChannel(s.server_log_channel)),
              field('Welcome', s.welcome_channel ? fmtChannel(s.welcome_channel) : '`not set`'),
              field('Goodbye', s.goodbye_channel ? fmtChannel(s.goodbye_channel) : '`not set`'),
              field('Autorole', s.autorole ? `<@&${s.autorole}>` : '`not set`'),
              field('Tickets', s.ticket_category ? '`configured`' : '`not set`'),
              field('Starboard', s.starboard_channel ? `${fmtChannel(s.starboard_channel)} @ ${s.starboard_emoji}` : '`not set`'),
              field('Levels', `${fmtBool(s.levels_enabled)} ${s.level_channel ? `→ ${fmtChannel(s.level_channel)}` : ''}`),
              field('Automod', fmtBool(a.enabled)),
              field('Suggestions', fmtChannel(s.suggestions_channel)),
              field('Temp rooms', s.tempvc_hub ? fmtChannel(s.tempvc_hub) : '`not set`'),
            ],
          }),
        ],
      });
    },
  },

  /* SETLOGS ──────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('setlogs')
      .setDescription('Choose where the bot logs things')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addChannelOption((o) => textChannel(o, 'modlog', 'Moderation actions'))
      .addChannelOption((o) => textChannel(o, 'messages', 'Message edits & deletes'))
      .addChannelOption((o) => textChannel(o, 'members', 'Joins, leaves, nickname & role changes'))
      .addChannelOption((o) => textChannel(o, 'voice', 'Voice channel activity'))
      .addChannelOption((o) => textChannel(o, 'server', 'Channels, roles, emojis, server edits')),
    async execute(interaction) {
      const patch = {};
      const set = [];
      const map = {
        modlog: 'modlog_channel',
        messages: 'msg_log_channel',
        members: 'member_log_channel',
        voice: 'voice_log_channel',
        server: 'server_log_channel',
      };
      for (const [option, column] of Object.entries(map)) {
        const channel = interaction.options.getChannel(option);
        if (channel) {
          patch[column] = channel.id;
          set.push(`${option} → ${channel}`);
        }
      }
      if (!set.length) return interaction.editReply({ embeds: [fail('Pick at least one channel.')] });
      setGuild(interaction.guild.id, patch);
      return interaction.editReply({ embeds: [ok(`Updated:\n${set.map((s) => `• ${s}`).join('\n')}`)] });
    },
  },

  /* SETWELCOME / SETGOODBYE ──────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('setwelcome')
      .setDescription('Configure welcome messages')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('channel')
          .setDescription('Set the welcome channel')
          .addChannelOption((o) => textChannel(o, 'channel', 'Welcome channel', true)),
      )
      .addSubcommand((s) =>
        s
          .setName('message')
          .setDescription('Set the welcome text')
          .addStringOption((o) =>
            o
              .setName('text')
              .setDescription('Placeholders: {user} {username} {server} {count} {createdat}')
              .setRequired(true)
              .setMaxLength(1500),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('embed')
          .setDescription('Send welcomes as an embed or plain text')
          .addBooleanOption((o) => o.setName('enabled').setDescription('Embed?').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('disable').setDescription('Turn welcome messages off')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'channel') {
        const ch = interaction.options.getChannel('channel');
        setGuild(interaction.guild.id, { welcome_channel: ch.id });
        return interaction.editReply({ embeds: [ok(`Welcome messages will go to ${ch}.`)] });
      }
      if (sub === 'message') {
        const text = interaction.options.getString('text');
        setGuild(interaction.guild.id, { welcome_message: text });
        return interaction.editReply({ embeds: [ok(`Welcome message updated.\n\n**Preview:**\n${text.replace(/\{user\}/g, `<@${interaction.user.id}>`).replace(/\{server\}/g, interaction.guild.name).replace(/\{count\}/g, '42').replace(/\{username\}/g, interaction.user.username)}`)] });
      }
      if (sub === 'embed') {
        setGuild(interaction.guild.id, { welcome_embed: interaction.options.getBoolean('enabled') ? 1 : 0 });
        return interaction.editReply({ embeds: [ok('Updated welcome style.')] });
      }
      setGuild(interaction.guild.id, { welcome_channel: null });
      return interaction.editReply({ embeds: [ok('Welcome messages disabled.')] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setgoodbye')
      .setDescription('Configure goodbye messages')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('channel')
          .setDescription('Set the goodbye channel')
          .addChannelOption((o) => textChannel(o, 'channel', 'Goodbye channel', true)),
      )
      .addSubcommand((s) =>
        s
          .setName('message')
          .setDescription('Set the goodbye text')
          .addStringOption((o) =>
            o.setName('text').setDescription('Placeholders: {user} {username} {server} {count}').setRequired(true).setMaxLength(1500),
          ),
      )
      .addSubcommand((s) => s.setName('disable').setDescription('Turn goodbye messages off')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'channel') {
        const ch = interaction.options.getChannel('channel');
        setGuild(interaction.guild.id, { goodbye_channel: ch.id });
        return interaction.editReply({ embeds: [ok(`Goodbye messages will go to ${ch}.`)] });
      }
      if (sub === 'message') {
        setGuild(interaction.guild.id, { goodbye_message: interaction.options.getString('text') });
        return interaction.editReply({ embeds: [ok('Goodbye message updated.')] });
      }
      setGuild(interaction.guild.id, { goodbye_channel: null });
      return interaction.editReply({ embeds: [ok('Goodbye messages disabled.')] });
    },
  },

  /* AUTOROLE ─────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('autorole')
      .setDescription('Roles given automatically to new members or bots')
      .setDefaultMemberPermissions(P.ManageRoles)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('human')
          .setDescription('Set the role new humans get')
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('bot')
          .setDescription('Set the role new bots get')
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('disable').setDescription('Disable autoroles')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'disable') {
        setGuild(interaction.guild.id, { autorole: null, bot_autorole: null });
        return interaction.editReply({ embeds: [ok('Autoroles disabled.')] });
      }
      const role = interaction.options.getRole('role');
      if (role.position >= interaction.guild.members.me.roles.highest.position)
        return interaction.editReply({ embeds: [fail('That role is above my highest role, I could not assign it.')] });
      setGuild(interaction.guild.id, sub === 'human' ? { autorole: role.id } : { bot_autorole: role.id });
      return interaction.editReply({ embeds: [ok(`New ${sub}s will receive ${role}.`)] });
    },
  },

  /* AUTOMOD ──────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('automod')
      .setDescription('Automatic moderation filters')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) => s.setName('status').setDescription('Show the automod configuration'))
      .addSubcommand((s) =>
        s
          .setName('toggle')
          .setDescription('Turn automod or a single filter on/off')
          .addStringOption((o) =>
            o
              .setName('module')
              .setDescription('What to toggle')
              .setRequired(true)
              .addChoices(
                { name: 'Automod (master switch)', value: 'enabled' },
                ...Object.entries(AUTOMOD_MODULES).map(([value, name]) => ({ name, value })),
              ),
          )
          .addBooleanOption((o) => o.setName('state').setDescription('On or off').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('words')
          .setDescription('Manage banned words')
          .addStringOption((o) =>
            o
              .setName('action')
              .setDescription('add / remove / list / clear')
              .setRequired(true)
              .addChoices(
                { name: 'add', value: 'add' },
                { name: 'remove', value: 'remove' },
                { name: 'list', value: 'list' },
                { name: 'clear', value: 'clear' },
              ),
          )
          .addStringOption((o) => o.setName('words').setDescription('Comma separated words').setMaxLength(500)),
      )
      .addSubcommand((s) =>
        s
          .setName('punishment')
          .setDescription('What happens when a filter triggers')
          .addStringOption((o) =>
            o
              .setName('action')
              .setDescription('Punishment')
              .setRequired(true)
              .addChoices(
                { name: 'Delete message only', value: 'delete' },
                { name: 'Delete + warn in chat', value: 'warn' },
                { name: 'Delete + timeout 10m', value: 'timeout' },
                { name: 'Delete + kick', value: 'kick' },
                { name: 'Delete + ban', value: 'ban' },
              ),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('limits')
          .setDescription('Tune the spam / caps / mention thresholds')
          .addIntegerOption((o) => o.setName('spam_count').setDescription('Messages per window').setMinValue(2).setMaxValue(30))
          .addIntegerOption((o) => o.setName('spam_window').setDescription('Window in seconds').setMinValue(1).setMaxValue(60))
          .addIntegerOption((o) => o.setName('caps_percent').setDescription('Caps % that triggers').setMinValue(30).setMaxValue(100))
          .addIntegerOption((o) => o.setName('mention_limit').setDescription('Max mentions per message').setMinValue(2).setMaxValue(50)),
      )
      .addSubcommand((s) =>
        s
          .setName('whitelist')
          .setDescription('Exempt a role or channel from automod')
          .addStringOption((o) =>
            o.setName('type').setDescription('Role or channel').setRequired(true).addChoices(
              { name: 'role', value: 'role' },
              { name: 'channel', value: 'channel' },
            ),
          )
          .addStringOption((o) => o.setName('id').setDescription('Role/channel ID or #mention').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('logs')
          .setDescription('Set the automod log channel')
          .addChannelOption((o) => textChannel(o, 'channel', 'Log channel', true)),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;
      const a = getAutomod(guildId);

      if (sub === 'status') {
        return interaction.editReply({
          embeds: [
            embed({
              title: '🛡️ Automod',
              color: a.enabled ? C.ok : C.muted,
              description: a.enabled ? '**Enabled**' : '**Disabled** — use `/automod toggle`',
              fields: [
                field('Punishment', a.punish === 'delete' ? 'Delete only' : a.punish),
                field('Spam', `${a.spam_count} msgs / ${a.spam_window}s`),
                field('Caps', `${a.caps_percent}%`),
                field('Mentions', `max ${a.mention_limit}`),
                { name: 'Filters', value: Object.entries(AUTOMOD_MODULES).map(([k, v]) => `${a[k] ? '✅' : '❌'} ${v}`).join('\n'), inline: false },
                { name: 'Banned words', value: a.banned_words ? a.banned_words.split(',').filter(Boolean).map((w) => `\`${w}\``).join(' ') : '*none*', inline: false },
              ],
            }),
          ],
        });
      }

      if (sub === 'toggle') {
        const module = interaction.options.getString('module');
        const state = interaction.options.getBoolean('state');
        setAutomod(guildId, { [module]: state ? 1 : 0 });
        return interaction.editReply({ embeds: [ok(`**${module.replace('_', ' ')}** is now ${state ? 'enabled' : 'disabled'}.`)] });
      }

      if (sub === 'words') {
        const action = interaction.options.getString('action');
        const words = getAutomod(guildId).banned_words.split(',').map((w) => w.trim()).filter(Boolean);
        if (action === 'list')
          return interaction.editReply({ embeds: [embed({ title: 'Banned words', description: words.length ? words.map((w) => `\`${w}\``).join(', ') : '*none*' })] });
        if (action === 'clear') {
          setAutomod(guildId, { banned_words: '' });
          return interaction.editReply({ embeds: [ok('Banned word list cleared.')] });
        }
        const input = (interaction.options.getString('words') || '')
          .split(',')
          .map((w) => w.trim().toLowerCase())
          .filter(Boolean);
        if (!input.length) return interaction.editReply({ embeds: [fail('Provide comma separated words.')] });
        const next = action === 'add' ? [...new Set([...words, ...input])] : words.filter((w) => !input.includes(w));
        setAutomod(guildId, { banned_words: next.join(',') });
        return interaction.editReply({ embeds: [ok(`List now contains **${next.length}** word(s).`)] });
      }

      if (sub === 'punishment') {
        const action = interaction.options.getString('action');
        setAutomod(guildId, { punish: action });
        return interaction.editReply({ embeds: [ok(`Punishment set to **${action}**.`)] });
      }

      if (sub === 'limits') {
        const patch = {};
        for (const key of ['spam_count', 'spam_window', 'caps_percent', 'mention_limit']) {
          const value = interaction.options.getInteger(key);
          if (value !== null) patch[key] = value;
        }
        if (!Object.keys(patch).length) return interaction.editReply({ embeds: [fail('Nothing to change.')] });
        setAutomod(guildId, patch);
        return interaction.editReply({ embeds: [ok(`Updated: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')}`)] });
      }

      if (sub === 'whitelist') {
        const type = interaction.options.getString('type');
        const raw = interaction.options.getString('id').replace(/[<#>]/g, '');
        if (!/^\d{17,20}$/.test(raw)) return interaction.editReply({ embeds: [fail('That is not a valid ID.')] });
        const column = type === 'role' ? 'whitelist_roles' : 'whitelist_channels';
        const current = (a[column] || '').split(',').filter(Boolean);
        const next = current.includes(raw) ? current.filter((x) => x !== raw) : [...current, raw];
        setAutomod(guildId, { [column]: next.join(',') });
        return interaction.editReply({ embeds: [ok(current.includes(raw) ? `Removed \`${raw}\` from the whitelist.` : `Added \`${raw}\` to the whitelist.`)] });
      }

      if (sub === 'logs') {
        setAutomod(guildId, { log_channel: interaction.options.getChannel('channel').id });
        return interaction.editReply({ embeds: [ok('Automod logs channel set.')] });
      }
    },
  },

  /* STARBOARD ────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('starboard')
      .setDescription('Starboard configuration')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('setup')
          .setDescription('Enable the starboard')
          .addChannelOption((o) => textChannel(o, 'channel', 'Starboard channel', true))
          .addStringOption((o) => o.setName('emoji').setDescription('Emoji to count (default ⭐)'))
          .addIntegerOption((o) => o.setName('threshold').setDescription('Stars needed (default 3)').setMinValue(1).setMaxValue(50)),
      )
      .addSubcommand((s) => s.setName('disable').setDescription('Disable the starboard'))
      .addSubcommand((s) =>
        s
          .setName('threshold')
          .setDescription('Change how many stars are needed')
          .addIntegerOption((o) => o.setName('stars').setDescription('1-50').setRequired(true).setMinValue(1).setMaxValue(50)),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'disable') {
        setGuild(interaction.guild.id, { starboard_channel: null });
        return interaction.editReply({ embeds: [ok('Starboard disabled.')] });
      }
      if (sub === 'threshold') {
        setGuild(interaction.guild.id, { starboard_threshold: interaction.options.getInteger('stars') });
        return interaction.editReply({ embeds: [ok(`Threshold set to **${interaction.options.getInteger('stars')}** stars.`)] });
      }
      const channel = interaction.options.getChannel('channel');
      const emoji = interaction.options.getString('emoji') || '⭐';
      const threshold = interaction.options.getInteger('threshold') || 3;
      setGuild(interaction.guild.id, { starboard_channel: channel.id, starboard_emoji: emoji, starboard_threshold: threshold });
      return interaction.editReply({ embeds: [ok(`Starboard enabled in ${channel} with ${emoji} at **${threshold}** stars.`)] });
    },
  },

  /* LEVELCONFIG ──────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('levelconfig')
      .setDescription('Leveling configuration')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('toggle')
          .setDescription('Enable or disable leveling')
          .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('channel')
          .setDescription('Where level-up announcements go (omit to disable)')
          .addChannelOption((o) => textChannel(o, 'channel', 'Announcement channel')),
      )
      .addSubcommand((s) =>
        s
          .setName('xp')
          .setDescription('XP awarded per message')
          .addIntegerOption((o) => o.setName('min').setDescription('Minimum XP').setRequired(true).setMinValue(1).setMaxValue(500))
          .addIntegerOption((o) => o.setName('max').setDescription('Maximum XP').setRequired(true).setMinValue(1).setMaxValue(500)),
      )
      .addSubcommand((s) =>
        s
          .setName('cooldown')
          .setDescription('Seconds between XP gains')
          .addIntegerOption((o) => o.setName('seconds').setDescription('5-3600').setRequired(true).setMinValue(5).setMaxValue(3600)),
      )
      .addSubcommandGroup((g) =>
        g
          .setName('reward')
          .setDescription('Roles awarded at a level')
          .addSubcommand((s) =>
            s
              .setName('add')
              .setDescription('Add a level reward')
              .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(500))
              .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
          )
          .addSubcommand((s) =>
            s
              .setName('remove')
              .setDescription('Remove a level reward')
              .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1)),
          )
          .addSubcommand((s) => s.setName('list').setDescription('List level rewards')),
      ),
    async execute(interaction) {
      const group = interaction.options.getSubcommandGroup(false);
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;

      if (group === 'reward') {
        if (sub === 'add') {
          const level = interaction.options.getInteger('level');
          const role = interaction.options.getRole('role');
          db.prepare('INSERT INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id')
            .run(guildId, level, role.id);
          return interaction.editReply({ embeds: [ok(`Members reaching level **${level}** will get ${role}.`)] });
        }
        if (sub === 'remove') {
          db.prepare('DELETE FROM level_rewards WHERE guild_id = ? AND level = ?').run(guildId, interaction.options.getInteger('level'));
          return interaction.editReply({ embeds: [ok('Reward removed.')] });
        }
        const rows = db.prepare('SELECT * FROM level_rewards WHERE guild_id = ? ORDER BY level ASC').all(guildId);
        return interaction.editReply({
          embeds: [embed({ title: 'Level rewards', description: rows.length ? rows.map((r) => `**Level ${r.level}** → <@&${r.role_id}>`).join('\n') : '*none*' })],
        });
      }

      if (sub === 'toggle') {
        setGuild(guildId, { levels_enabled: interaction.options.getBoolean('enabled') ? 1 : 0 });
        return interaction.editReply({ embeds: [ok('Leveling updated.')] });
      }
      if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel');
        setGuild(guildId, { level_channel: channel?.id ?? null });
        return interaction.editReply({ embeds: [ok(channel ? `Level-ups will be announced in ${channel}.` : 'Level-up announcements disabled.')] });
      }
      if (sub === 'xp') {
        const min = interaction.options.getInteger('min');
        const max = interaction.options.getInteger('max');
        if (min > max) return interaction.editReply({ embeds: [fail('Minimum cannot be greater than maximum.')] });
        setGuild(guildId, { xp_min: min, xp_max: max });
        return interaction.editReply({ embeds: [ok(`XP per message set to **${min}-${max}**.`)] });
      }
      if (sub === 'cooldown') {
        const seconds = interaction.options.getInteger('seconds');
        setGuild(guildId, { xp_cooldown: seconds * 1000 });
        return interaction.editReply({ embeds: [ok(`XP cooldown set to **${formatDuration(seconds * 1000)}**.`)] });
      }
    },
  },

  /* TEMPROOMS ────────────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('temprooms')
      .setDescription('Join-to-create temporary voice channels')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('setup')
          .setDescription('Set the hub voice channel members join to create a room')
          .addChannelOption((o) =>
            o.setName('hub').setDescription('Hub voice channel').addChannelTypes(ChannelType.GuildVoice).setRequired(true),
          )
          .addChannelOption((o) =>
            o.setName('category').setDescription('Category for new rooms').addChannelTypes(ChannelType.GuildCategory),
          ),
      )
      .addSubcommand((s) => s.setName('disable').setDescription('Disable temporary rooms')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'disable') {
        setGuild(interaction.guild.id, { tempvc_hub: null, tempvc_category: null });
        return interaction.editReply({ embeds: [ok('Temporary rooms disabled.')] });
      }
      const hub = interaction.options.getChannel('hub');
      const category = interaction.options.getChannel('category');
      setGuild(interaction.guild.id, { tempvc_hub: hub.id, tempvc_category: category?.id ?? null });
      return interaction.editReply({ embeds: [ok(`Members joining ${hub} will get their own room.`)] });
    },
  },

];

export default { category, commands };
