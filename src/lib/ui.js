import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { config } from '../config.js';

export const C = config.colors;

/* ── Embeds ───────────────────────────────────────────────────────────────── */
export function embed(data = {}) {
  const e = new EmbedBuilder();
  if (data.title) e.setTitle(String(data.title).slice(0, 256));
  if (data.description) e.setDescription(String(data.description).slice(0, 4096));
  if (data.url) e.setURL(data.url);
  if (data.color !== null) e.setColor(data.color ?? C.brand);
  if (data.fields?.length) e.addFields(data.fields.slice(0, 25));
  if (data.author) e.setAuthor(data.author);
  if (data.thumbnail) e.setThumbnail(data.thumbnail);
  if (data.image) e.setImage(data.image);
  if (data.footer) e.setFooter(typeof data.footer === 'string' ? { text: data.footer } : data.footer);
  if (data.timestamp !== false) e.setTimestamp(data.timestamp ? new Date(data.timestamp) : new Date());
  return e;
}

export const ok = (description, title = 'Success') => embed({ title: `✅ ${title}`, description, color: C.ok });
export const fail = (description, title = 'Error') => embed({ title: `❌ ${title}`, description, color: C.error });
export const warn = (description, title = 'Heads up') => embed({ title: `⚠️ ${title}`, description, color: C.warn });
export const info = (description, title = 'Info') => embed({ title: `ℹ️ ${title}`, description, color: C.brand });

export function field(name, value, inline = true) {
  return { name, value: value === undefined || value === '' ? '—' : String(value).slice(0, 1024), inline };
}

/* ── Components ───────────────────────────────────────────────────────────── */
export const EPH = MessageFlags.Ephemeral;

export const row = (...components) => new ActionRowBuilder().addComponents(components);

export function button({ id, label, style = ButtonStyle.Secondary, emoji, disabled = false, url }) {
  const b = new ButtonBuilder().setDisabled(disabled);
  if (label) b.setLabel(String(label).slice(0, 80));
  if (emoji) b.setEmoji(emoji);
  if (url) b.setURL(url);
  else b.setCustomId(id);
  b.setStyle(url ? ButtonStyle.Link : style);
  return b;
}

export const btn = {
  primary: (id, label, emoji) => button({ id, label, style: ButtonStyle.Primary, emoji }),
  success: (id, label, emoji) => button({ id, label, style: ButtonStyle.Success, emoji }),
  danger: (id, label, emoji) => button({ id, label, style: ButtonStyle.Danger, emoji }),
  secondary: (id, label, emoji) => button({ id, label, style: ButtonStyle.Secondary, emoji }),
};

export function selectMenu({ id, placeholder, options, min = 1, max = 1, disabled = false }) {
  return row(
    new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .setDisabled(disabled)
      .setMinValues(min)
      .setMaxValues(max)
      .addOptions(options),
  );
}

/* ── Reply shortcuts ──────────────────────────────────────────────────────── */
export const reply = (interaction, data, ephemeral = false) =>
  interaction.reply(ephemeral ? { ...data, flags: EPH } : data);

export const editReply = (interaction, data) => interaction.editReply(data);

export function deny(interaction, message = 'You cannot use that.') {
  return interaction.reply({ embeds: [fail(message)], flags: EPH });
}

/* ── Formatting ───────────────────────────────────────────────────────────── */
export const divider = () => '─'.repeat(28);

export function codeList(items, empty = 'None') {
  return items.length ? items.map((i) => `• ${i}`).join('\n') : `*${empty}*`;
}

export function table(rows, headings) {
  const head = `**${headings.join('** │ **')}**`;
  const body = rows.map((r) => r.join(' │ ')).join('\n');
  return `${head}\n${'─'.repeat(headings.length * 8)}\n${body}`;
}
