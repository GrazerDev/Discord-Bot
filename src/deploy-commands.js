import { REST, Routes } from 'discord.js';
import { assertConfig, config } from './config.js';
import { commandJson } from './commands/index.js';

assertConfig();

const rest = new REST({ version: '10' }).setToken(config.token);
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

async function registerGlobal(body) {
  const data = await rest.put(Routes.applicationCommands(config.clientId), { body });
  console.log(`✅ ${data.length} global commands registered.`);
  if (data.length) {
    console.log('   Discord can take up to an hour to show these in every server.');
    console.log('   Global registration is rate-limited — register once, not in a loop.');
  }
}

async function registerGuild(guildId, body) {
  try {
    const data = await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body });
    if (body.length) {
      console.log(`✅ ${data.length} commands registered in guild ${guildId} (instant).`);
      console.log('   Note: guild commands only exist in that server — register globally for multi-server bots.');
    } else {
      console.log(`🧹 Cleared all commands from guild ${guildId}.`);
    }
    return true;
  } catch (err) {
    console.error(`❌ Guild ${guildId} failed: ${err.message}`);
    return false;
  }
}

async function main() {
  /* ── clearing ─────────────────────────────────────────────────────────────
   * Stale per-guild copies show up as duplicates next to the global commands,
   * so switching from guild to global needs an explicit wipe.
   * ──────────────────────────────────────────────────────────────────────── */
  if (has('--clear-guild')) {
    if (!config.guildIds.length) {
      console.error('Nothing to clear — GUILD_IDS is empty.');
      return;
    }
    for (const guildId of config.guildIds) await registerGuild(guildId, []);
    return;
  }

  if (has('--clear-global')) {
    await registerGlobal([]);
    console.log('   all global commands removed.');
    return;
  }

  const body = commandJson;
  console.log(`Registering ${body.length} commands…`);

  /* ── registration ─────────────────────────────────────────────────────────
   * Explicit flags win; otherwise: guild when GUILD_IDS is set, else global.
   * ──────────────────────────────────────────────────────────────────────── */
  if (has('--global')) return registerGlobal(body);
  if (has('--guild') && config.guildIds.length) {
    for (const guildId of config.guildIds) await registerGuild(guildId, body);
    return;
  }
  if (config.guildIds.length) {
    for (const guildId of config.guildIds) await registerGuild(guildId, body);
    return;
  }
  return registerGlobal(body);
}

main().catch((err) => {
  console.error('❌ Command registration failed:', err.message);
  process.exit(1);
});
