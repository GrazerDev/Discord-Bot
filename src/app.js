import http from 'node:http';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { assertConfig, config } from './config.js';
import { startPersistence, finalSnapshot } from './lib/persist.js';
import { commands } from './commands/index.js';

import ready from './events/ready.js';
import interactionCreate from './events/interactionCreate.js';
import messageCreate from './events/messageCreate.js';
import messageLogs from './events/messageLogs.js';
import memberEvents from './events/memberEvents.js';
import voiceStateUpdate from './events/voiceStateUpdate.js';
import reactions from './events/reactions.js';
import guildEvents from './events/guildEvents.js';

/**
 * Boots the bot. Called from index.js *after* the database has been restored
 * from a backup — that ordering matters on hosts without a persistent disk.
 */
export function startBot() {
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
    await finalSnapshot().catch(() => {});
    try {
      client.destroy();
    } catch {
      /* already destroyed */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  /* ──────────────────────────────────────────────────────────────────────────
   * Optional health endpoint. Render/Fly/uptime monitors need a port that
   * answers HTTP; set PORT to enable it. Harmless when PORT is unset.
   * ────────────────────────────────────────────────────────────────────────── */
  if (process.env.PORT) {
    const startedAt = Date.now();
    http
      .createServer((req, res) => {
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
      })
      .listen(Number(process.env.PORT), '0.0.0.0', () => {
        console.log(`Health endpoint listening on :${process.env.PORT}/health`);
      });
  }

  startPersistence();
  console.log('Starting Nexus…');

  client.login(config.token).catch((err) => {
    const message = String(err?.message ?? err);
    console.error('\n❌ Login failed:', message);

    if (/used disallowed intents/i.test(message)) {
      console.error(
        `\n   Discord error 4014 — this app is asking for privileged intents that are
   switched off. Fix it in 30 seconds, no rebuild needed:

     1. https://discord.com/developers/applications -> your app -> Bot
     2. Privileged Gateway Intents -> turn on BOTH:
          [x] SERVER MEMBERS INTENT
          [x] MESSAGE CONTENT INTENT
     3. Save Changes
     4. Restart this service (Restart, not "Clear build cache & deploy")
`,
      );
    } else if (/invalid token|401: unauthorized|unauthorized/i.test(message)) {
      console.error(
        `\n   The bot token was rejected. Reset it in the Developer Portal
   (Bot -> Reset Token), paste the new value into this service's environment
   variables as DISCORD_TOKEN, then redeploy. Watch for a trailing space.
`,
      );
    } else if (/missing access|missing permissions/i.test(message)) {
      console.error('\n   The bot lacks permissions in a guild — re-invite it with the applications.commands scope.');
    } else if (/ENOTFOUND|ECONNREFUSED|fetch failed|ETIMEDOUT/i.test(message)) {
      console.error('\n   The host could not reach discord.com. Usually transient — restart once before investigating.');
    }

    process.exit(1);
  });

  return client;
}
