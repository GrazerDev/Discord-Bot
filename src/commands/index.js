import moderation from './moderation.js';
import configModule from './config.js';
import levels from './levels.js';
import economy from './economy.js';
import music from './music.js';
import tickets from './tickets.js';
import giveaways from './giveaways.js';
import roles from './roles.js';
import social from './social.js';
import utility from './utility.js';
import fun from './fun.js';
import tags from './tags.js';
import reminders from './reminders.js';
import context from './context.js';
import ai from './ai.js';

const modules = [
  moderation,
  configModule,
  levels,
  economy,
  music,
  tickets,
  giveaways,
  roles,
  social,
  utility,
  fun,
  tags,
  reminders,
  context,
  ai,
];

export const commands = [];
export const components = {};

for (const mod of modules) {
  for (const command of mod.commands ?? []) {
    command.category ??= mod.category;
    commands.push(command);
  }
  Object.assign(components, mod.components ?? {});
}

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));

export const commandJson = commands.map((c) => c.data.toJSON());

export const stats = {
  commands: commands.length,
  contextMenus: commands.filter((c) => c.data.type).length,
  components: Object.keys(components).length,
};

export default { commands, components };
