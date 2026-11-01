import http from 'node:http';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { assertConfig, config } from './config.js';
import { commands } from './commands/index.js';

import ready from './events/ready.js';
import interactionCreate from './events/interactionCreate.js';
import messageCreate from './events/messageCreate.js';
import messageLogs from './events/messageLogs.js';
import memberEvents from './events/memberEvents.js';
import voiceStateUpdate from './events/voiceStateUpdate.js';
import reactions from './events/reactions.js';
import guildEvents from './events/guildEvents.js';

assertConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User],
  allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
});

/* The registry is attached to the client so command modules can look
 * commands up without importing each other (no circular imports). */
client.commands = new Map(commands.map((command) => [command.data.name, command]));

for (const register of [
  ready,
  interactionCreate,
  messageCreate,
  messageLogs,
  memberEvents,
  voiceStateUpdate,
  reactions,
  guildEvents,
]) {
  register(client);
}

client.on('error', (err) => console.error('[client error]', err));
client.on('warn', (msg) => console.warn('[client warn]', msg));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

const shutdown = async (signal) => {
  console.log(`\n${signal} received — shutting down.`);
  try {
    client.destroy();
  } catch {
    /* noop */
  }
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/* ────────────────────────────────────────────────────────────────────────────
 * Optional health endpoint. Render/Fly/uptime monitors want a port that
 * answers HTTP; set PORT to enable it. Harmless when PORT is unset.
 * ──────────────────────────────────────────────────────────────────────────── */
if (process.env.PORT) {
  const startedAt = Date.now();
  const server = http.createServer((req, res) => {
    const body = JSON.stringify({
      status: client.isReady() ? 'online' : 'starting',
      user: client.user?.tag ?? null,
      guilds: client.guilds.cache.size,
      ping: Math.round(client.ws.ping),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      commands: client.commands.size,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  });
  server.listen(Number(process.env.PORT), '0.0.0.0', () => {
    console.log(`Health endpoint listening on :${process.env.PORT}/health`);
  });
}

console.log('Starting Nexus…');
client.login(config.token).catch((err) => {
  console.error('\n❌ Login failed:', err.message);
  if (err.message?.includes('invalid')) {
    console.error('   Double-check DISCORD_TOKEN in your .env / host environment variables.');
  }
  process.exit(1);
});
