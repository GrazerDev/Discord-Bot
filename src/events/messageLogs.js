import { Events, AuditLogEvent } from 'discord.js';
import { snipes, editSnipes } from '../lib/cache.js';
import { logEvent } from '../lib/logs.js';
import { embed, C } from '../lib/ui.js';
import { truncate } from '../lib/helpers.js';

export default function register(client) {
  client.on(Events.MessageDelete, async (message) => {
    if (!message.guild || message.author?.bot) return;

    snipes.set(message.channelId, {
      content: message.content,
      author: message.author?.tag ?? 'Unknown',
      avatar: message.author?.displayAvatarURL?.() ?? null,
      createdAt: message.createdTimestamp,
      attachments: message.attachments?.size ?? 0,
    });

    if (!message.content && !message.attachments?.size) return;

    await logEvent(message.guild, 'msg_log_channel', {
      embeds: [
        embed({
          title: '🗑️ Message deleted',
          color: C.error,
          description: truncate(message.content || '*no text*', 3000),
          fields: [
            { name: 'Author', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Attachments', value: String(message.attachments?.size ?? 0), inline: true },
          ],
          footer: { text: `Message ID: ${message.id}` },
        }),
      ],
    });
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;

    editSnipes.set(newMessage.channelId, {
      before: oldMessage.content ?? '',
      after: newMessage.content ?? '',
      author: newMessage.author?.tag ?? 'Unknown',
    });

    await logEvent(newMessage.guild, 'msg_log_channel', {
      embeds: [
        embed({
          title: '✏️ Message edited',
          color: C.warn,
          fields: [
            { name: 'Author', value: `${newMessage.author} (\`${newMessage.author.id}\`)`, inline: true },
            { name: 'Channel', value: `<#${newMessage.channelId}>`, inline: true },
            { name: 'Jump', value: `[open](${newMessage.url})`, inline: true },
            { name: 'Before', value: truncate(oldMessage.content || '*empty*', 900) },
            { name: 'After', value: truncate(newMessage.content || '*empty*', 900) },
          ],
        }),
      ],
    });
  });

  /* Bulk deletes are not emitted as individual MessageDelete events */
  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    if (!channel.guild || messages.size === 0) return;
    await logEvent(channel.guild, 'msg_log_channel', {
      embeds: [
        embed({
          title: `🧹 ${messages.size} messages bulk deleted`,
          color: C.error,
          description: truncate(
            [...messages.values()]
              .reverse()
              .slice(0, 20)
              .map((m) => `**${m.author?.tag ?? 'unknown'}**: ${truncate(m.content, 100)}`)
              .join('\n'),
            3000,
          ),
          fields: [{ name: 'Channel', value: `<#${channel.id}>`, inline: true }],
        }),
      ],
    });
  });
}

export { AuditLogEvent };
