import { Events, MessageFlags, InteractionType } from 'discord.js';
import { commands, components } from '../commands/index.js';
import { embed, fail, C } from '../lib/ui.js';
import { bumpStat } from '../db.js';
import { config } from '../config.js';

const cooldowns = new Map();
const COOLDOWN_MS = 2500;

const isOwner = (userId) => config.ownerIds.includes(userId);

function checkCooldown(userId, key) {
  const now = Date.now();
  const bucket = cooldowns.get(`${userId}:${key}`) ?? 0;
  if (now - bucket < COOLDOWN_MS) return COOLDOWN_MS - (now - bucket);
  cooldowns.set(`${userId}:${key}`, now);
  if (cooldowns.size > 5000) cooldowns.clear();
  return 0;
}

/**
 * custom ids can be `ticket:open`, `sug:up:12` or `br:msgId:roleId`. Try the
 * longest matching key first so handlers can register whatever prefix they like.
 */
function findHandler(customId) {
  const parts = customId.split(':');
  for (let i = parts.length; i > 0; i -= 1) {
    const key = parts.slice(0, i).join(':');
    if (components[key]) return { key, args: parts.slice(i) };
  }
  return null;
}

export default function register(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      /* ── autocomplete ─────────────────────────────────────────────────── */
      if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
        const command = client.commands.get(interaction.commandName);
        if (command?.autocomplete) await command.autocomplete(interaction);
        else await interaction.respond([]).catch(() => {});
        return;
      }

      /* ── slash commands + context menus ───────────────────────────────── */
      if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) {
          return interaction.reply({ embeds: [fail('That command is not loaded. Try redeploying commands.')], flags: MessageFlags.Ephemeral });
        }

        const wait = checkCooldown(interaction.user.id, interaction.commandName);
        if (wait > 0 && !isOwner(interaction.user.id)) {
          return interaction.reply({ embeds: [fail(`Slow down — try again in ${(wait / 1000).toFixed(1)}s.`)], flags: MessageFlags.Ephemeral });
        }

        if (interaction.guildId) bumpStat(interaction.guildId, 'commands');

        const ephemeral = interaction.isContextMenuCommand();
        await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
        await command.execute(interaction, client);
        return;
      }

      /* ── buttons & select menus ───────────────────────────────────────── */
      if (interaction.isButton() || interaction.isAnySelectMenu()) {
        const handler = findHandler(interaction.customId);
        const matched = handler?.key;
        const args = handler?.args;
        if (!handler) {
          return interaction.reply({
            embeds: [fail('This component is no longer active.')],
            flags: MessageFlags.Ephemeral,
          });
        }
        await components[matched](interaction, args, client);
        return;
      }

      /* ── modals ───────────────────────────────────────────────────────── */
      if (interaction.type === InteractionType.ModalSubmit) {
        const found = findHandler(interaction.customId);
        if (!found) {
          return interaction.reply({ embeds: [fail('This form is no longer active.')], flags: MessageFlags.Ephemeral });
        }
        await components[found.key](interaction, found.args, client);
      }
    } catch (err) {
      console.error('[interaction]', interaction.commandName ?? interaction.customId, err);
      const payload = {
        embeds: [
          embed({
            title: '❌ Something went wrong',
            description: `\`\`\`\n${String(err?.message ?? err).slice(0, 900)}\n\`\`\``,
            color: C.error,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch {
        /* the interaction is gone */
      }
    }
  });
}
