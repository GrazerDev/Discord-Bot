import { Events } from 'discord.js';
import { getGuild, bumpStat } from '../db.js';
import { logEvent } from '../lib/logs.js';
import { embed, C, field } from '../lib/ui.js';
import { applyPlaceholders, timestamp, formatNumber } from '../lib/helpers.js';

export default function register(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    const settings = getGuild(member.guild.id);
    bumpStat(member.guild.id, 'joins');

    const roleId = member.user.bot ? settings.bot_autorole : settings.autorole;
    if (roleId) await member.roles.add(roleId, 'Autorole').catch(() => {});

    await logEvent(member.guild, 'member_log_channel', {
      embeds: [
        embed({
          title: '📥 Member joined',
          color: C.ok,
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
          description: `${member} ${member.user.tag}`,
          fields: [
            field('Account created', `${timestamp(member.user.createdTimestamp, 'D')} (${timestamp(member.user.createdTimestamp)})`, false),
            field('Members now', formatNumber(member.guild.memberCount)),
          ],
        }),
      ],
    });

    if (!settings.welcome_channel) return;
    const channel = member.guild.channels.cache.get(settings.welcome_channel);
    if (!channel?.isTextBased()) return;

    const text = applyPlaceholders(settings.welcome_message, {
      user: member.user,
      member,
      guild: member.guild,
      count: member.guild.memberCount,
    });

    if (settings.welcome_embed) {
      await channel
        .send({
          embeds: [
            embed({
              description: text,
              color: C.ok,
              thumbnail: member.user.displayAvatarURL({ size: 512 }),
            }),
          ],
        })
        .catch(() => {});
    } else {
      await channel.send({ content: text, allowedMentions: { users: [member.id] } }).catch(() => {});
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const settings = getGuild(member.guild.id);
    bumpStat(member.guild.id, 'leaves');

    await logEvent(member.guild, 'member_log_channel', {
      embeds: [
        embed({
          title: '📤 Member left',
          color: C.error,
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
          description: `${member.user.tag} (\`${member.id}\`)`,
          fields: [
            field('Joined', member.joinedTimestamp ? timestamp(member.joinedTimestamp, 'R') : 'unknown'),
            field('Members now', formatNumber(member.guild.memberCount)),
          ],
        }),
      ],
    });

    if (!settings.goodbye_channel) return;
    const channel = member.guild.channels.cache.get(settings.goodbye_channel);
    if (!channel?.isTextBased()) return;

    const text = applyPlaceholders(settings.goodbye_message, {
      user: member.user,
      member,
      guild: member.guild,
      count: member.guild.memberCount,
    });
    await channel.send({ embeds: [embed({ description: text, color: C.error })] }).catch(() => {});
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (oldMember.nickname !== newMember.nickname) {
      await logEvent(newMember.guild, 'member_log_channel', {
        embeds: [
          embed({
            title: '📝 Nickname changed',
            color: C.muted,
            description: `${newMember} \`${oldMember.nickname ?? 'none'}\` → \`${newMember.nickname ?? 'none'}\``,
          }),
        ],
      });
    }

    const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
    if (added.size || removed.size) {
      await logEvent(newMember.guild, 'member_log_channel', {
        embeds: [
          embed({
            title: '🎭 Roles updated',
            color: C.brand,
            description: `${newMember}`,
            fields: [
              ...(added.size ? [field('Added', added.map((r) => `${r}`).join(' '), false)] : []),
              ...(removed.size ? [field('Removed', removed.map((r) => `${r}`).join(' '), false)] : []),
            ],
          }),
        ],
      });
    }

    if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
      const timedOut = newMember.communicationDisabledUntilTimestamp;
      await logEvent(newMember.guild, 'modlog_channel', {
        embeds: [
          embed({
            title: timedOut ? '🔇 Member timed out' : '🔊 Timeout removed',
            color: timedOut ? C.error : C.ok,
            description: `${newMember} (\`${newMember.id}\`)${timedOut ? ` until ${timestamp(timedOut, 'f')}` : ''}`,
          }),
        ],
      });
    }
  });
}
