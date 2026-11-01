import { Events } from 'discord.js';
import { logEvent } from '../lib/logs.js';
import { embed, C, field } from '../lib/ui.js';

const audit = async (guild, type, id) => {
  const entries = await guild.fetchAuditLogs({ type, limit: 1 }).catch(() => null);
  const entry = entries?.entries?.first();
  if (!entry) return null;
  if (id && entry.targetId !== id) return null;
  if (Date.now() - entry.createdTimestamp > 15000) return null;
  return entry.executor;
};

export default function register(client) {
  client.on(Events.ChannelCreate, (channel) => {
    if (!channel.guild) return;
    logEvent(channel.guild, 'server_log_channel', {
      embeds: [embed({ title: '📁 Channel created', color: C.ok, description: `${channel} \`${channel.name}\` (${channel.type})` })],
    });
  });

  client.on(Events.ChannelDelete, (channel) => {
    if (!channel.guild) return;
    logEvent(channel.guild, 'server_log_channel', {
      embeds: [embed({ title: '🗂️ Channel deleted', color: C.error, description: `\`${channel.name}\` (${channel.type})` })],
    });
  });

  client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const changes = [];
    if (oldChannel.name !== newChannel.name) changes.push(`name: \`${oldChannel.name}\` → \`${newChannel.name}\``);
    if ('topic' in oldChannel && oldChannel.topic !== newChannel.topic)
      changes.push(`topic: \`${oldChannel.topic ?? 'none'}\` → \`${newChannel.topic ?? 'none'}\``);
    if ('rateLimitPerUser' in oldChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser)
      changes.push(`slowmode: ${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s`);
    if (!changes.length) return;

    logEvent(newChannel.guild, 'server_log_channel', {
      embeds: [embed({ title: '✏️ Channel updated', color: C.warn, description: `${newChannel}\n${changes.join('\n')}` })],
    });
  });

  client.on(Events.GuildRoleCreate, (role) => {
    logEvent(role.guild, 'server_log_channel', {
      embeds: [embed({ title: '🎭 Role created', color: C.ok, description: `${role} \`${role.name}\`` })],
    });
  });

  client.on(Events.GuildRoleDelete, (role) => {
    logEvent(role.guild, 'server_log_channel', {
      embeds: [embed({ title: '🎭 Role deleted', color: C.error, description: `\`${role.name}\`` })],
    });
  });

  client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push(`name: \`${oldRole.name}\` → \`${newRole.name}\``);
    if (oldRole.hexColor !== newRole.hexColor) changes.push(`colour: ${oldRole.hexColor} → ${newRole.hexColor}`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push('permissions changed');
    if (!changes.length) return;

    logEvent(newRole.guild, 'server_log_channel', {
      embeds: [embed({ title: '🎭 Role updated', color: C.warn, description: `${newRole}\n${changes.join('\n')}` })],
    });
  });

  client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push(`name: **${oldGuild.name}** → **${newGuild.name}**`);
    if (oldGuild.icon !== newGuild.icon) changes.push('icon changed');
    if (!changes.length) return;

    logEvent(newGuild, 'server_log_channel', {
      embeds: [embed({ title: '🏠 Server updated', color: C.warn, description: changes.join('\n') })],
    });
  });

  client.on(Events.GuildBanAdd, async (ban) => {
    const executor = await audit(ban.guild, 'MEMBER_BAN_ADD', ban.user.id);
    logEvent(ban.guild, 'modlog_channel', {
      embeds: [
        embed({
          title: '🔨 Member banned',
          color: C.error,
          description: `${ban.user.tag} (\`${ban.user.id}\`)`,
          fields: [
            field('Moderator', executor ? `${executor.tag}` : 'Unknown'),
            field('Reason', ban.reason ?? 'None', false),
          ],
        }),
      ],
    });
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    logEvent(ban.guild, 'modlog_channel', {
      embeds: [embed({ title: '♻️ Member unbanned', color: C.ok, description: `${ban.user.tag} (\`${ban.user.id}\`)` })],
    });
  });
}
