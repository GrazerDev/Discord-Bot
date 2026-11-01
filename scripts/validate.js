/**
 * Offline sanity check — no Discord connection required.
 * Run with `npm run check`.
 */
import { commands, components, stats } from '../src/commands/index.js';

const SLASH_NAME_RE = /^[-_\p{L}\p{N}]{1,32}$/u;
const MENU_NAME_RE = /^[\p{L}\p{N} _'-]{1,32}$/u;
const seen = new Map();
let problems = 0;

const fail = (msg) => {
  problems += 1;
  console.error(`  ✗ ${msg}`);
};

console.log('\n─── Command validation ───────────────────────────────────────────');

for (const command of commands) {
  const json = command.data.toJSON();
  const key = `${json.type ?? 1}:${json.name}`;
  if (seen.has(key)) fail(`duplicate command "${json.name}" (type ${json.type ?? 1})`);
  seen.set(key, command);

  const isMenu = json.type === 2 || json.type === 3;
  if (isMenu ? !MENU_NAME_RE.test(json.name) : !SLASH_NAME_RE.test(json.name))
    fail(`invalid name "${json.name}"`);
  if (json.type === undefined || json.type === 1) {
    if (!json.description) fail(`/${json.name} has no description`);
    if (json.description && json.description.length > 100)
      fail(`/${json.name} description is ${json.description.length} chars (max 100)`);
  }
  if (!json.description_localizations && json.description === '') fail(`/${json.name} empty description`);
  if (typeof command.execute !== 'function') fail(`/${json.name} has no execute()`);

  const walk = (options = []) => {
    for (const option of options) {
      if (!option.description) fail(`/${json.name} → option "${option.name}" has no description`);
      if (option.description && option.description.length > 100)
        fail(`/${json.name} → option "${option.name}" description too long (${option.description.length})`);
      if (option.options) walk(option.options);
    }
  };
  walk(json.options);
}

const chatInput = commands.filter((c) => !c.data.type || c.data.type === 1).length;
const contextMenus = commands.filter((c) => c.data.type === 2 || c.data.type === 3).length;

if (chatInput + contextMenus > 100) {
  fail(`Discord allows at most 100 global commands — you have ${chatInput + contextMenus}. Use GUILD_IDS to register per-server instead.`);
}

console.log(`  ${chatInput} slash commands`);
console.log(`  ${contextMenus} context menu commands`);
console.log(`  ${stats.components} component handlers: ${Object.keys(components).join(', ')}`);

console.log('\n─── Module import check ──────────────────────────────────────────');
console.log('  ✓ every command module imported without throwing');

if (problems) {
  console.error(`\n❌ ${problems} problem(s) found.\n`);
  process.exit(1);
}
console.log('\n✅ All checks passed.\n');
