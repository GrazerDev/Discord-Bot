import { getGuild } from '../db.js';
import { C } from './ui.js';

/**
 * Send a log embed to a configured channel. Never throws — logging must not
 * break a command.
 * @param {import('discord.js').Guild} guild
 * @param {string} key column in the guilds table, e.g. 'modlog_channel'
 */
export async function logEvent(guild, key, payload) {
  if (!guild) return;
  try {
    const settings = getGuild(guild.id);
    const channelId = settings[key];
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return;
    await channel.send(payload).catch(() => {});
  } catch {
    /* ignore */
  }
}

export function modLogEmbed({ title, color = C.brand, description, fields = [], footer }) {
  const data = { title, color, fields, timestamp: new Date().toISOString() };
  if (description) data.description = description;
  if (footer) data.footer = { text: footer };
  return { embeds: [data] };
}
