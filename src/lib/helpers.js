import { PermissionFlagsBits } from 'discord.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );

export const truncate = (str, max = 1024) =>
  !str ? '' : str.length <= max ? str : `${str.slice(0, max - 1)}…`;

export const formatNumber = (n) => Number(n || 0).toLocaleString('en-US');

export const timestamp = (ms, style = 'R') => `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;

export const userMention = (id) => `<@${id}>`;
export const channelMention = (id) => `<@${id}>`.replace('@', '#');
export const roleMention = (id) => `<@&${id}>`;

export const snowflakeTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);

const UNITS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_592_000_000,
  y: 31_536_000_000,
};

/** "1d12h30m" → milliseconds. Returns null if nothing parseable. */
export function parseDuration(input = '') {
  const str = String(input).toLowerCase().trim();
  if (/^\d+$/.test(str)) return Number(str) * 1000; // bare number = seconds
  let total = 0;
  let matched = false;
  for (const m of str.matchAll(/(\d+(?:\.\d+)?)\s*(mo|[smhdwy])/g)) {
    total += Number(m[1]) * UNITS[m[2]];
    matched = true;
  }
  return matched ? Math.round(total) : null;
}

/** 3725000 → "1h 2m 5s" */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const parts = [];
  const units = [
    ['y', UNITS.y],
    ['mo', UNITS.mo],
    ['d', UNITS.d],
    ['h', UNITS.h],
    ['m', UNITS.m],
    ['s', UNITS.s],
  ];
  let left = ms;
  for (const [label, size] of units) {
    if (left >= size) {
      const value = Math.floor(left / size);
      left -= value * size;
      parts.push(`${value}${label}`);
      if (parts.length === 2) break;
    }
  }
  return parts.join(' ') || '0s';
}

export const shortDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function progressBar(value, max, size = 12) {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)}`;
}

export const escapeMarkdown = (s = '') => String(s).replace(/([*_`~\\|>])/g, '\\$1');

export function sanitizeChannelName(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 90) || 'channel'
  );
}

/** Returns a human readable reason a moderator may NOT act on a target, or null. */
export function hierarchyProblem(actor, target, me) {
  if (!target) return 'That member is not in this server.';
  if (target.id === actor.id) return 'You cannot do that to yourself.';
  if (target.id === target.client.user.id) return 'I cannot do that to myself.';
  if (target.id === target.guild.ownerId) return 'You cannot action the server owner.';
  if (
    actor.id !== actor.guild.ownerId &&
    actor.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    return 'That member has a role equal to or higher than yours.';
  }
  if (me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return 'My role is below theirs — move my role higher in the role list.';
  }
  return null;
}

export function hasPerm(member, ...flags) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.permissions.has(flags);
}

export const isOwner = (userId, ownerIds) => ownerIds.includes(userId);

/** Replace {user} {username} {server} {count} {tag} placeholders. */
export function applyPlaceholders(template, ctx) {
  const map = {
    '{user}': ctx.user ? `<@${ctx.user.id}>` : '',
    '{username}': ctx.user?.username ?? '',
    '{tag}': ctx.user?.tag ?? '',
    '{displayname}': ctx.user?.displayName ?? ctx.user?.username ?? '',
    '{server}': ctx.guild?.name ?? '',
    '{count}': String(ctx.count ?? ''),
    '{createdat}': ctx.user ? timestamp(ctx.user.createdTimestamp, 'D') : '',
    '{joinedat}': ctx.member?.joinedTimestamp ? timestamp(ctx.member.joinedTimestamp, 'D') : '',
  };
  return Object.entries(map).reduce(
    (out, [key, value]) => out.split(key).join(value),
    String(template ?? ''),
  );
}

export async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': 'NexusBot/2.0 (+https://github.com)', ...(options.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const CODEBLOCK = (text, lang = '') =>
  `\`\`\`${lang}\n${String(text).replace(/```/g, '`​``')}\n\`\`\``;
