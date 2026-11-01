import { SlashCommandBuilder, PermissionFlagsBits as P } from 'discord.js';
import { db } from '../db.js';
import { embed, ok, fail, field, C, EPH } from '../lib/ui.js';
import { truncate, timestamp } from '../lib/helpers.js';

const category = 'Tags';

const norm = (s) => String(s || '').trim().toLowerCase().slice(0, 32);
const nameOption = (o, description = 'Tag name') =>
  o.setName('name').setDescription(description).setRequired(true).setMaxLength(32).setAutocomplete(true);

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('tag')
      .setDescription('Reusable snippets of text')
      .setDMPermission(false)
      .addSubcommand((s) =>
        s.setName('get').setDescription('Show a tag').addStringOption((o) => nameOption(o)),
      )
      .addSubcommand((s) =>
        s.setName('create').setDescription('Create a tag')
          .addStringOption((o) => nameOption(o))
          .addStringOption((o) => o.setName('content').setDescription('What the tag says').setRequired(true).setMaxLength(1900)),
      )
      .addSubcommand((s) =>
        s.setName('edit').setDescription('Edit a tag you own')
          .addStringOption((o) => nameOption(o))
          .addStringOption((o) => o.setName('content').setDescription('New content').setRequired(true).setMaxLength(1900)),
      )
      .addSubcommand((s) =>
        s.setName('delete').setDescription('Delete a tag').addStringOption((o) => nameOption(o)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('List every tag'))
      .addSubcommand((s) => s.setName('random').setDescription('Show a random tag'))
      .addSubcommand((s) =>
        s.setName('info').setDescription('Who made a tag and how often it is used').addStringOption((o) => nameOption(o)),
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;
      const name = norm(interaction.options.getString('name'));

      if (sub === 'list') {
        const rows = db.prepare('SELECT name, uses FROM tags WHERE guild_id = ? ORDER BY name ASC LIMIT 100').all(guildId);
        if (!rows.length) return interaction.editReply({ embeds: [fail('No tags yet. Create one with `/tag create`.')] });
        return interaction.editReply({
          embeds: [
            embed({
              title: `🏷️ Tags (${rows.length})`,
              color: C.brand,
              description: rows.map((r) => `\`${r.name}\`${r.uses ? ` (${r.uses})` : ''}`).join(' · '),
            }),
          ],
        });
      }

      if (sub === 'random') {
        const row = db.prepare('SELECT * FROM tags WHERE guild_id = ? ORDER BY RANDOM() LIMIT 1').get(guildId);
        if (!row) return interaction.editReply({ embeds: [fail('No tags yet.')] });
        return interaction.editReply({ content: row.content, allowedMentions: { parse: [] } });
      }

      const tag = db.prepare('SELECT * FROM tags WHERE guild_id = ? AND name = ?').get(guildId, name);

      if (sub === 'get') {
        if (!tag) return interaction.editReply({ embeds: [fail(`No tag called \`${name}\`.`)] });
        db.prepare('UPDATE tags SET uses = uses + 1 WHERE guild_id = ? AND name = ?').run(guildId, name);
        return interaction.editReply({ content: tag.content, allowedMentions: { parse: [] } });
      }

      if (sub === 'info') {
        if (!tag) return interaction.editReply({ embeds: [fail(`No tag called \`${name}\`.`)] });
        return interaction.editReply({
          embeds: [
            embed({
              title: `Tag │ ${tag.name}`,
              color: C.brand,
              description: truncate(tag.content, 500),
              fields: [
                field('Author', `<@${tag.author_id}>`),
                field('Uses', String(tag.uses)),
                field('Created', timestamp(tag.created_at, 'R')),
              ],
            }),
          ],
        });
      }

      if (sub === 'create') {
        if (tag) return interaction.editReply({ embeds: [fail(`A tag called \`${name}\` already exists.`)] });
        db.prepare('INSERT INTO tags (guild_id, name, content, author_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(guildId, name, interaction.options.getString('content'), interaction.user.id, Date.now());
        return interaction.editReply({ embeds: [ok(`Created tag \`${name}\`.`)] });
      }

      if (!tag) return interaction.editReply({ embeds: [fail(`No tag called \`${name}\`.`)] });

      if (sub === 'edit') {
        if (tag.author_id !== interaction.user.id && !interaction.member.permissions.has(P.ManageGuild))
          return interaction.editReply({ embeds: [fail('Only the author or an admin can edit this tag.')] });
        db.prepare('UPDATE tags SET content = ? WHERE guild_id = ? AND name = ?')
          .run(interaction.options.getString('content'), guildId, name);
        return interaction.editReply({ embeds: [ok(`Updated \`${name}\`.`)] });
      }

      if (tag.author_id !== interaction.user.id && !interaction.member.permissions.has(P.ManageGuild))
        return interaction.editReply({ embeds: [fail('Only the author or an admin can delete this tag.')] });
      db.prepare('DELETE FROM tags WHERE guild_id = ? AND name = ?').run(guildId, name);
      return interaction.editReply({ embeds: [ok(`Deleted \`${name}\`.`)] });
    },
    async autocomplete(interaction) {
      const focused = norm(interaction.options.getFocused());
      const rows = db
        .prepare('SELECT name FROM tags WHERE guild_id = ? AND name LIKE ? ORDER BY uses DESC LIMIT 25')
        .all(interaction.guild.id, `%${focused}%`);
      await interaction.respond(rows.map((r) => ({ name: r.name, value: r.name })));
    },
  },

  /* AUTORESPONDERS ───────────────────────────────────────────────────────── */
  {
    data: new SlashCommandBuilder()
      .setName('autoresponder')
      .setDescription('Reply automatically when a message contains certain text')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s.setName('add').setDescription('Add an autoresponder')
          .addStringOption((o) => o.setName('trigger').setDescription('Text that triggers it').setRequired(true).setMaxLength(100))
          .addStringOption((o) => o.setName('response').setDescription('What the bot replies').setRequired(true).setMaxLength(1500))
          .addStringOption((o) =>
            o.setName('match').setDescription('How to match').addChoices(
              { name: 'Contains', value: 'contains' },
              { name: 'Exact message', value: 'exact' },
              { name: 'Starts with', value: 'starts' },
            ),
          ),
      )
      .addSubcommand((s) =>
        s.setName('remove').setDescription('Remove an autoresponder')
          .addStringOption((o) => o.setName('trigger').setDescription('Trigger text').setRequired(true).setAutocomplete(true)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('List autoresponders')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;

      if (sub === 'list') {
        const rows = db.prepare('SELECT * FROM autoresponders WHERE guild_id = ?').all(guildId);
        if (!rows.length) return interaction.editReply({ embeds: [fail('No autoresponders yet.')] });
        return interaction.editReply({
          embeds: [
            embed({
              title: `Autoresponders (${rows.length})`,
              color: C.brand,
              description: truncate(rows.map((r) => `\`${r.trigger}\` (${r.match}) → ${r.response}`).join('\n'), 3500),
            }),
          ],
        });
      }

      const trigger = norm(interaction.options.getString('trigger'));
      if (sub === 'remove') {
        const res = db.prepare('DELETE FROM autoresponders WHERE guild_id = ? AND trigger = ?').run(guildId, trigger);
        return interaction.editReply({ embeds: [res.changes ? ok(`Removed \`${trigger}\`.`) : fail('No such autoresponder.')] });
      }

      const response = interaction.options.getString('response');
      const match = interaction.options.getString('match') ?? 'contains';
      db.prepare('INSERT INTO autoresponders (guild_id, trigger, response, match, author_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, trigger) DO UPDATE SET response = excluded.response, match = excluded.match')
        .run(guildId, trigger, response, match, interaction.user.id);
      return interaction.editReply({ embeds: [ok(`Autoresponder \`${trigger}\` saved (${match}).`)] });
    },
    async autocomplete(interaction) {
      const focused = norm(interaction.options.getFocused());
      const rows = db
        .prepare('SELECT trigger FROM autoresponders WHERE guild_id = ? AND trigger LIKE ? LIMIT 25')
        .all(interaction.guild.id, `%${focused}%`);
      await interaction.respond(rows.map((r) => ({ name: r.trigger, value: r.trigger })));
    },
  },
];

export default { category, commands };
