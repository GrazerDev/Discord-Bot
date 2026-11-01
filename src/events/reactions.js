import { Events, ChannelType } from 'discord.js';
import { db, getGuild } from '../db.js';
import { embed, C, field } from '../lib/ui.js';
import { truncate } from '../lib/helpers.js';

const emojiKey = (emoji) => (emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name);

export default function register(client) {
  /* ── reaction roles ─────────────────────────────────────────────────────── */
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    const message = reaction.message;
    if (!message.guild) return;

    const key = emojiKey(reaction.emoji);
    const mapping = db
      .prepare('SELECT * FROM reaction_roles WHERE message_id = ? AND (emoji = ? OR emoji = ?)')
      .get(message.id, key, reaction.emoji.name);

    if (mapping) {
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (member) await member.roles.add(mapping.role_id, 'Reaction role').catch(() => {});
    }

    /* ── starboard ──────────────────────────────────────────────────────── */
    const settings = getGuild(message.guild.id);
    if (!settings.starboard_channel) return;
    const targetEmoji = settings.starboard_emoji || '⭐';
    if (reaction.emoji.name !== targetEmoji && key !== targetEmoji) return;
    if (message.channelId === settings.starboard_channel) return;
    if (message.author.bot) return;

    const count = reaction.count ?? 1;
    if (count < settings.starboard_threshold) return;

    const board = message.guild.channels.cache.get(settings.starboard_channel);
    if (!board?.isTextBased()) return;

    const existing = db
      .prepare('SELECT * FROM starboard_posts WHERE guild_id = ? AND original_id = ?')
      .get(message.guild.id, message.id);

    const starEmbed = embed({
      author: { name: message.author.tag, icon_url: message.author.displayAvatarURL() },
      description: truncate(message.content || '*no text*', 3000),
      color: C.star,
      image: message.attachments.first()?.url,
      fields: [{ name: 'Source', value: `[jump to message](${message.url})`, inline: false }],
      footer: { text: `${targetEmoji} ${count} • #${message.channel.name}` },
    });

    if (existing) {
      const post = await board.messages.fetch(existing.starboard_id).catch(() => null);
      if (post) {
        await post.edit({ embeds: [starEmbed] }).catch(() => {});
        db.prepare('UPDATE starboard_posts SET stars = ? WHERE guild_id = ? AND original_id = ?')
          .run(count, message.guild.id, message.id);
      }
      return;
    }

    const post = await board
      .send({ content: `${targetEmoji} **${count}** — <#${message.channelId}>`, embeds: [starEmbed] })
      .catch(() => null);
    if (post) {
      db.prepare('INSERT INTO starboard_posts (guild_id, original_id, starboard_id, stars) VALUES (?, ?, ?, ?)')
        .run(message.guild.id, message.id, post.id, count);
    }
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    const message = reaction.message;
    if (!message.guild) return;

    const key = emojiKey(reaction.emoji);
    const mapping = db
      .prepare('SELECT * FROM reaction_roles WHERE message_id = ? AND (emoji = ? OR emoji = ?)')
      .get(message.id, key, reaction.emoji.name);

    if (mapping) {
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (member) await member.roles.remove(mapping.role_id, 'Reaction role removed').catch(() => {});
    }

    const settings = getGuild(message.guild.id);
    if (!settings.starboard_channel) return;
    const targetEmoji = settings.starboard_emoji || '⭐';
    if (reaction.emoji.name !== targetEmoji && key !== targetEmoji) return;

    const existing = db
      .prepare('SELECT * FROM starboard_posts WHERE guild_id = ? AND original_id = ?')
      .get(message.guild.id, message.id);
    if (!existing) return;

    const count = reaction.count ?? 0;
    if (count < settings.starboard_threshold) {
      const board = message.guild.channels.cache.get(settings.starboard_channel);
      const post = await board?.messages?.fetch(existing.starboard_id).catch(() => null);
      await post?.delete().catch(() => {});
      db.prepare('DELETE FROM starboard_posts WHERE guild_id = ? AND original_id = ?').run(message.guild.id, message.id);
    } else {
      db.prepare('UPDATE starboard_posts SET stars = ? WHERE guild_id = ? AND original_id = ?')
        .run(count, message.guild.id, message.id);
    }
  });
}
