import { Events, ChannelType, PermissionFlagsBits } from 'discord.js';
import { getGuild, db } from '../db.js';
import { GuildMusic } from '../lib/music.js';
import { logEvent } from '../lib/logs.js';
import { embed, C, field } from '../lib/ui.js';

export default function register(client) {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;
    const guild = newState.guild;

    /* ── temporary voice rooms ──────────────────────────────────────────── */
    const settings = getGuild(guild.id);
    if (settings.tempvc_hub) {
      if (newState.channelId === settings.tempvc_hub) {
        const parent = settings.tempvc_category ? guild.channels.cache.get(settings.tempvc_category) : newState.channel?.parent;
        const channel = await guild.channels
          .create({
            name: `🔊 ${member.user.username}`,
            type: ChannelType.GuildVoice,
            parent: parent?.id ?? null,
            permissionOverwrites: [
              { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
              {
                id: member.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.Connect,
                  PermissionFlagsBits.ManageChannels,
                  PermissionFlagsBits.MoveMembers,
                ],
              },
            ],
            reason: 'Temporary voice room',
          })
          .catch(() => null);
        if (channel) {
          db.prepare('INSERT OR REPLACE INTO temp_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)')
            .run(channel.id, guild.id, member.id);
          await member.voice.setChannel(channel).catch(() => {});
          await channel
            .send({
              embeds: [
                embed({
                  description:
                    `👋 Welcome to your temporary room, ${member}!\n\n` +
                    'Rename or delete this channel — it disappears when everyone leaves.\n' +
                    '`/voice limit <n>` and `/voice kick <user>` are coming from the channel itself.',
                  color: C.brand,
                }),
              ],
            })
            .catch(() => {});
        }
      }

      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const record = db.prepare('SELECT * FROM temp_channels WHERE channel_id = ?').get(oldState.channelId);
        if (record) {
          const channel = oldState.channel;
          if (!channel || channel.members.filter((m) => !m.user.bot).size === 0) {
            db.prepare('DELETE FROM temp_channels WHERE channel_id = ?').run(record.channel_id);
            await channel?.delete('Temporary room empty').catch(() => {});
          }
        }
      }
    }

    /* ── temporary room subcommands via prefix-free helpers (leave/limit) ─ */
    /* ── voice logs ─────────────────────────────────────────────────────── */
    if (settings.voice_log_channel) {
      const parts = [];
      if (!oldState.channelId && newState.channelId) {
        parts.push(embed({
          title: '🔊 Joined voice',
          color: C.ok,
          description: `${member} → <#${newState.channelId}>`,
        }));
      } else if (oldState.channelId && !newState.channelId) {
        parts.push(embed({
          title: '🔈 Left voice',
          color: C.muted,
          description: `${member} ← <#${oldState.channelId}>`,
        }));
      } else if (oldState.channelId !== newState.channelId) {
        parts.push(embed({
          title: '🔀 Moved voice channels',
          color: C.brand,
          description: `${member}`,
          fields: [
            field('From', `<#${oldState.channelId}>`),
            field('To', `<#${newState.channelId}>`),
          ],
        }));
      }
      if (parts.length) await logEvent(guild, 'voice_log_channel', { embeds: parts });
    }

    /* ── music: leave when alone ────────────────────────────────────────── */
    const queue = GuildMusic.get(guild.id);
    if (queue) {
      const listeners = queue.voiceChannel.members.filter((m) => !m.user.bot).size;
      if (listeners === 0) {
        setTimeout(() => {
          const stillEmpty = queue.voiceChannel.members.filter((m) => !m.user.bot).size === 0;
          if (stillEmpty) {
            queue.destroy();
            queue.textChannel?.send({ embeds: [embed({ description: '👋 Everyone left — stopping the player.', color: C.muted })] }).catch(() => {});
          }
        }, 30_000);
      }
    }
  });
}
