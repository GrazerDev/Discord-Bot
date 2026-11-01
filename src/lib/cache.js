/** Volatile, in-memory state that does not need to survive a restart. */

export const snipes = new Map(); // channelId -> { content, author, createdAt, attachments }
export const editSnipes = new Map(); // channelId -> { before, after, author }
export const reactionSnipes = new Map(); // channelId -> { emoji, user, messageId }

export const automodTracker = new Map(); // `${guildId}:${userId}` -> [timestamps]

export const activeGames = new Map(); // messageId -> game state

export function trackSpam(key, windowMs) {
  const now = Date.now();
  const hits = (automodTracker.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  automodTracker.set(key, hits);
  return hits.length;
}

export function cleanupTrackers(maxAge = 600_000) {
  const now = Date.now();
  for (const [key, hits] of automodTracker.entries()) {
    const fresh = hits.filter((t) => now - t < maxAge);
    if (fresh.length) automodTracker.set(key, fresh);
    else automodTracker.delete(key);
  }
}
