import { Events, PermissionFlagsBits } from 'discord.js';
import { getGuild, getAutomod, db, bumpStat } from '../db.js';
import { handleMessageXp } from '../commands/levels.js';
import { trackSpam } from '../lib/cache.js';
import { config } from '../config.js';
import { embed, C } from '../lib/ui.js';
import { formatDuration, truncate } from '../lib/helpers.js';

const INVITE_RE = /(discord\.(gg|me|io)|discord(app)?\.com\/invite)\/[\w-]{2,}/i;
const LINK_RE = /https?:\/\/[^\s]+/i;
const ZALGO_RE = /[\u0300-\u036f\u0489]{4,}/;

function whitelisted(message, automod) {
  const channels = (automod.whitelist_channels || '').split(',').filter(Boolean);
  if (channels.includes(message.channel.id) || channels.includes(message.channel.parentId)) return true;
  const roles = (automod.whitelist_roles || '').split(',').filter(Boolean);
  if (roles.length && message.member && roles.some((r) => message.member.roles.cache.has(r))) return true;
  if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  return false;
}

async function punish(message, automod, reason) {
  const guild = message.guild;
  const me = guild.members.me;

  await message.delete().catch(() => {});

  let action = automod.punish;
  const member = message.member;

  try {
    if (action === 'timeout' && member?.moderatable) await member.timeout(10 * 60_000, `Automod: ${reason}`);
    else if (action === 'kick' && member?.kickable) await member.kick(`Automod: ${reason}`);
    else if (action === 'ban' && member?.bannable) await member.ban({ reason: `Automod: ${reason}` });
    else action = 'delete';
  } catch {
    action = 'delete';
  }

  const logChannel = automod.log_channel ? guild.channels.cache.get(automod.log_channel) : null;
  if (logChannel?.isTextBased()) {
    await logChannel
      .send({
        embeds: [
          embed({
            title: '🛡️ Automod',
            color: C.error,
            fields: [
              { name: 'Member', value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true },
              { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
              { name: 'Action', value: action, inline: true },
              { name: 'Reason', value: reason },
              { name: 'Message', value: truncate(message.content || '*empty*', 900) },
            ],
          }),
        ],
      })
      .catch(() => {});
  }

  if (action === 'warn' || action === 'delete') {
    await message.channel
      .send({ content: `${message.author}, ${reason}`, allowedMentions: { repliedUser: false } })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 6000))
      .catch(() => {});
  }
  return true;
}

export default function register(client) {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.guild || message.author.bot || message.system) return;

    bumpStat(message.guild.id, 'messages');

    /* ── AFK ────────────────────────────────────────────────────────────── */
    const afk = db.prepare('SELECT * FROM afk WHERE guild_id = ? AND user_id = ?').get(message.guild.id, message.author.id);
    if (afk) {
      db.prepare('DELETE FROM afk WHERE guild_id = ? AND user_id = ?').run(message.guild.id, message.author.id);
      await message
        .reply({ content: `👋 Welcome back — you were AFK for **${formatDuration(Date.now() - afk.since)}**.`, allowedMentions: { repliedUser: true } })
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 8000))
        .catch(() => {});
    }

    if (message.mentions.users.size) {
      const mentions = [...message.mentions.users.values()].filter((u) => !u.bot).slice(0, 3);
      for (const user of mentions) {
        const row = db.prepare('SELECT * FROM afk WHERE guild_id = ? AND user_id = ?').get(message.guild.id, user.id);
        if (row) {
          await message
            .reply({ content: `💤 **${user.username}** is AFK: ${truncate(row.status, 200)}`, allowedMentions: { repliedUser: false } })
            .then((m) => setTimeout(() => m.delete().catch(() => {}), 8000))
            .catch(() => {});
          break;
        }
      }
    }

    /* ── Automod ────────────────────────────────────────────────────────── */
    if (config.features.automod && message.member) {
      const automod = getAutomod(message.guild.id);
      if (automod.enabled && !whitelisted(message, automod)) {
        const content = message.content ?? '';
        const reasons = [];

        if (automod.anti_invite && INVITE_RE.test(content)) reasons.push('posting server invites');
        if (automod.anti_link && LINK_RE.test(content)) reasons.push('posting links');
        if (automod.anti_zalgo && ZALGO_RE.test(content)) reasons.push('posting glitch text');
        if (automod.anti_newline && (content.match(/\n/g) ?? []).length > automod.newline_limit) reasons.push('newline spam');

        if (automod.anti_mention) {
          const total = message.mentions.users.size + message.mentions.roles.size;
          if (total > automod.mention_limit) reasons.push(`mentioning ${total} users/roles`);
        }

        if (automod.anti_caps && content.length > 12) {
          const letters = content.replace(/[^a-zA-Z]/g, '');
          const upper = content.replace(/[^A-Z]/g, '');
          if (letters.length > 8 && (upper.length / letters.length) * 100 > automod.caps_percent) reasons.push('excessive caps');
        }

        if (automod.banned_words) {
          const words = automod.banned_words.split(',').filter(Boolean);
          const lower = content.toLowerCase();
          const hit = words.find((w) => lower.includes(w));
          if (hit) reasons.push(`using the banned word \`${hit}\``);
        }

        if (automod.anti_spam) {
          const hits = trackSpam(`${message.guild.id}:${message.author.id}`, automod.spam_window * 1000);
          if (hits > automod.spam_count) reasons.push('message flooding');
        }

        if (reasons.length) {
          const handled = await punish(message, automod, `Automod: ${reasons.join(', ')}`);
          if (handled) return; // stop processing this message
        }
      }
    }

    /* ── Autoresponders ─────────────────────────────────────────────────── */
    const responders = db.prepare('SELECT * FROM autoresponders WHERE guild_id = ?').all(message.guild.id);
    if (responders.length && message.content) {
      const lower = message.content.toLowerCase();
      const hit = responders.find((r) => {
        if (r.match === 'exact') return lower.trim() === r.trigger;
        if (r.match === 'starts') return lower.startsWith(r.trigger);
        return lower.includes(r.trigger);
      });
      if (hit) {
        await message
          .reply({ content: hit.response, allowedMentions: { repliedUser: false, parse: [] } })
          .catch(() => {});
      }
    }

    /* ── Leveling ───────────────────────────────────────────────────────── */
    await handleMessageXp(message).catch(() => {});
  });
}
