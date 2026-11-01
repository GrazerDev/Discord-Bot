import {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits as P,
} from 'discord.js';
import { getGuild } from '../db.js';
import { embed, ok, fail, field, C, EPH } from '../lib/ui.js';
import { timestamp, truncate } from '../lib/helpers.js';

const category = 'Context';

const userEmbed = (user, member) => {
  const fields = [
    field('ID', `\`${user.id}\``),
    field('Bot', user.bot ? 'Yes' : 'No'),
    field('Account created', `${timestamp(user.createdTimestamp, 'D')} (${timestamp(user.createdTimestamp)})`, false),
  ];
  if (member?.joinedTimestamp)
    fields.push(field('Joined server', `${timestamp(member.joinedTimestamp, 'D')} (${timestamp(member.joinedTimestamp)})`, false));
  if (member)
    fields.push(
      field('Top role', `${member.roles.highest}`),
      field('Roles', `${member.roles.cache.size - 1}`),
    );
  return embed({ title: user.tag, thumbnail: user.displayAvatarURL({ size: 256 }), color: C.brand, fields });
};

const commands = [
  {
    data: new ContextMenuCommandBuilder().setName('User Info').setType(ApplicationCommandType.User).setDMPermission(false),
    async execute(interaction) {
      const user = interaction.targetUser;
      const member = interaction.targetMember;
      return interaction.editReply({ embeds: [userEmbed(user, member)] });
    },
  },
  {
    data: new ContextMenuCommandBuilder().setName('Avatar').setType(ApplicationCommandType.User).setDMPermission(false),
    async execute(interaction) {
      const user = await interaction.client.users.fetch(interaction.targetId, { force: true });
      return interaction.editReply({
        embeds: [embed({ title: `${user.username}’s avatar`, image: user.displayAvatarURL({ size: 1024 }), color: C.brand })],
      });
    },
  },
  {
    data: new ContextMenuCommandBuilder().setName('Bookmark Message').setType(ApplicationCommandType.Message).setDMPermission(false),
    async execute(interaction) {
      const message = interaction.targetMessage;
      const embedData = embed({
        title: '🔖 Bookmarked message',
        description: truncate(message.content || '*no text content*', 3500),
        color: C.brand,
        fields: [
          field('Author', `${message.author.tag}`),
          field('Channel', `<#${message.channelId}>`),
          field('Jump', `[open](${message.url})`),
        ],
      });

      const attachments = [...message.attachments.values()].slice(0, 5).map((a) => a.url);
      try {
        await interaction.user.send({ embeds: [embedData], content: attachments.join('\n') || undefined });
      } catch {
        return interaction.editReply({ embeds: [fail('I could not DM you — check your privacy settings.')] });
      }
      return interaction.editReply({ embeds: [ok('Saved to your DMs.')] });
    },
  },
  {
    data: new ContextMenuCommandBuilder().setName('Report Message').setType(ApplicationCommandType.Message).setDMPermission(false),
    async execute(interaction) {
      const settings = getGuild(interaction.guild.id);
      if (!settings.modlog_channel)
        return interaction.editReply({ embeds: [fail('Reporting is not set up — an admin needs to run `/setlogs modlog:#channel`.')] });

      const message = interaction.targetMessage;
      const logChannel = interaction.guild.channels.cache.get(settings.modlog_channel);
      if (!logChannel?.isTextBased()) return interaction.editReply({ embeds: [fail('The mod-log channel is missing.')] });

      await logChannel.send({
        embeds: [
          embed({
            title: '🚩 Message reported',
            color: C.error,
            description: truncate(message.content || '*no text content*', 3000),
            fields: [
              field('Author', `${message.author.tag} (\`${message.author.id}\`)`),
              field('Reported by', `${interaction.user.tag} (\`${interaction.user.id}\`)`),
              field('Channel', `<#${message.channelId}>`),
              field('Jump', `[open](${message.url})`, false),
              ...(message.attachments.size ? [field('Attachments', String(message.attachments.size))] : []),
            ],
          }),
        ],
      });

      return interaction.editReply({ embeds: [ok('Reported to the moderators. Thank you.')] });
    },
  },
  {
    data: new ContextMenuCommandBuilder().setName('Copy Message ID').setType(ApplicationCommandType.Message).setDMPermission(false),
    async execute(interaction) {
      return interaction.editReply({ content: `\`${interaction.targetId}\`` });
    },
  },
];

export default { category, commands };
