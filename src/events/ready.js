import { Events, ActivityType } from 'discord.js';
import { config } from '../config.js';
import { commands, components } from '../commands/index.js';
import { startScheduler } from '../lib/scheduler.js';
import { checkBinaries } from '../lib/music.js';
import { cleanupTrackers } from '../lib/cache.js';

const STATUS = {
  online: 'online',
  idle: 'idle',
  dnd: 'dnd',
  invisible: 'invisible',
};

export default function register(client) {
  client.once(Events.ClientReady, async (c) => {
    console.log(`\n✅ Logged in as ${c.user.tag} (${c.user.id})`);
    console.log(`   ${c.guilds.cache.size} guild(s) · ${commands.length} commands · ${Object.keys(components).length} component handlers\n`);

    c.user.setPresence({
      status: STATUS[config.presenceStatus] ?? 'online',
      activities: [{ name: config.presence, type: ActivityType.Custom }],
    });

    startScheduler(c);
    setInterval(() => cleanupTrackers(), 10 * 60_000).unref?.();

    const bins = await checkBinaries();
    if (config.music.enabled && !bins.ok) {
      console.warn('⚠️  Music is enabled but yt-dlp/ffmpeg are missing — /play will explain this to users.');
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    console.log(`➕ Joined guild: ${guild.name} (${guild.id}) — ${guild.memberCount} members`);
    const owner = await guild.fetchOwner().catch(() => null);
    if (!owner) return;
    await owner
      .send({
        embeds: [
          {
            color: 0x5865f2,
            title: `Thanks for adding me to ${guild.name}!`,
            description:
              'Here is how to get set up in about two minutes:\n\n' +
              '**1.** `/setlogs modlog:#mod-log messages:#message-log members:#member-log`\n' +
              '**2.** `/setwelcome channel:#welcome` and `/autorole human:@Member`\n' +
              '**3.** `/automod toggle module:Automod (master switch) state:true`\n' +
              '**4.** `/ticketconfig` + `/ticketpanel` for support tickets\n' +
              '**5.** `/help` lists every command\n\n' +
              'Tip: run `/settings` at any time to see what is configured.',
          },
        ],
      })
      .catch(() => {});
  });
}
