import { REST, Routes } from 'discord.js';
import { assertConfig, config } from './config.js';
import { commandJson } from './commands/index.js';

assertConfig();

const rest = new REST({ version: '10' }).setToken(config.token);

async function main() {
  const body = commandJson;
  console.log(`Registering ${body.length} commands…`);

  if (config.guildIds.length) {
    for (const guildId of config.guildIds) {
      try {
        const data = await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body });
        console.log(`✅ ${data.length} commands registered in guild ${guildId} (instant).`);
      } catch (err) {
        console.error(`❌ Guild ${guildId} failed: ${err.message}`);
      }
    }
    return;
  }

  const data = await rest.put(Routes.applicationCommands(config.clientId), { body });
  console.log(`✅ ${data.length} global commands registered. Discord can take up to an hour to show them everywhere.`);
}

main().catch((err) => {
  console.error('❌ Command registration failed:', err.message);
  process.exit(1);
});
