import {
  SlashCommandBuilder,
  PermissionFlagsBits as P,
  ChannelType,
  AttachmentBuilder,
} from 'discord.js';
import { getGuild, setGuild, db } from '../db.js';
import { embed, ok, fail, field, C, row, btn, EPH } from '../lib/ui.js';
import { truncate, sanitizeChannelName, timestamp } from '../lib/helpers.js';
import { logEvent, modLogEmbed } from '../lib/logs.js';

const category = 'Tickets';

const panelEmbed = () =>
  embed({
    title: '🎫 Support tickets',
    description:
      'Need help from the staff team?\n\n' +
      '**Click the button below** and a private channel will be created where you can explain your issue.\n' +
      'Only you and the staff can see it.',
    color: C.brand,
    footer: { text: 'One ticket per member at a time' },
  });

const openRow = () => row(btn.primary('ticket:open', 'Open a ticket', '🎫'));

async function transcript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const lines = [...messages.values()]
    .reverse()
    .map((m) => {
      const attachments = m.attachments.size ? ` [attachments: ${m.attachments.map((a) => a.url).join(' ')}]` : '';
      const embeds = m.embeds.length ? ` [${m.embeds.length} embed(s)]` : '';
      return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag} (${m.author.id}): ${m.content}${attachments}${embeds}`;
    });
  const header = `Transcript for #${channel.name}\nCreated: ${timestamp(channel.createdTimestamp, 'F')}\nMessages: ${lines.length}\n\n`;
  return new AttachmentBuilder(Buffer.from(header + lines.join('\n'), 'utf8'), {
    name: `${sanitizeChannelName(channel.name)}-transcript.txt`,
  });
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('ticketpanel')
      .setDescription('Post the ticket panel in this channel')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false),
    async execute(interaction) {
      const settings = getGuild(interaction.guild.id);
      if (!settings.ticket_category)
        return interaction.editReply({
          embeds: [fail('Set up tickets first with `/ticketconfig category`, `/ticketconfig staff` and `/ticketconfig log`.')],
        });
      await interaction.channel.send({ embeds: [panelEmbed()], components: [openRow()] });
      return interaction.editReply({ embeds: [ok('Ticket panel posted.')] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('ticketconfig')
      .setDescription('Configure the ticket system')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('category')
          .setDescription('Category new tickets are created in')
          .addChannelOption((o) => o.setName('category').setDescription('Category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('staff')
          .setDescription('Role that can see tickets')
          .addRoleOption((o) => o.setName('role').setDescription('Staff role').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('log')
          .setDescription('Channel that receives transcripts')
          .addChannelOption((o) => o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),
      )
      .addSubcommand((s) => s.setName('status').setDescription('Show the current ticket configuration')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const settings = getGuild(interaction.guild.id);
      if (sub === 'category') {
        const category = interaction.options.getChannel('category');
        setGuild(interaction.guild.id, { ticket_category: category.id });
        return interaction.editReply({ embeds: [ok(`Tickets will be created under **${category.name}**.`)] });
      }
      if (sub === 'staff') {
        const role = interaction.options.getRole('role');
        setGuild(interaction.guild.id, { ticket_staff_role: role.id });
        return interaction.editReply({ embeds: [ok(`Staff role set to ${role}.`)] });
      }
      if (sub === 'log') {
        const channel = interaction.options.getChannel('channel');
        setGuild(interaction.guild.id, { ticket_log_channel: channel.id });
        return interaction.editReply({ embeds: [ok(`Transcripts will be sent to ${channel}.`)] });
      }
      return interaction.editReply({
        embeds: [
          embed({
            title: '🎫 Ticket configuration',
            color: C.brand,
            fields: [
              field('Category', settings.ticket_category ? `<#${settings.ticket_category}>` : '`not set`'),
              field('Staff role', settings.ticket_staff_role ? `<@&${settings.ticket_staff_role}>` : '`not set`'),
              field('Transcript log', settings.ticket_log_channel ? `<#${settings.ticket_log_channel}>` : '`not set`'),
              field('Tickets opened', String(settings.ticket_count ?? 0)),
            ],
          }),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Manage the ticket you are in')
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a member to this ticket')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a member from this ticket')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('close').setDescription('Close this ticket')),
    async execute(interaction) {
      const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(interaction.channel.id);
      if (!ticket) return interaction.editReply({ embeds: [fail('This channel is not a ticket.')] });

      const sub = interaction.options.getSubcommand();
      if (sub === 'close') return closeTicket(interaction, ticket, interaction.user);

      const user = interaction.options.getUser('user');
      const overwrite = interaction.channel.permissionOverwrites.cache.get(user.id);
      if (sub === 'add') {
        await interaction.channel.permissionOverwrites.edit(user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
        });
        return interaction.editReply({ embeds: [ok(`${user} was added to this ticket.`)] });
      }
      if (!overwrite) return interaction.editReply({ embeds: [fail(`${user} is not in this ticket.`)] });
      await interaction.channel.permissionOverwrites.delete(user.id);
      return interaction.editReply({ embeds: [ok(`${user} was removed from this ticket.`)] });
    },
  },
];

async function closeTicket(interaction, ticket, closer) {
  await interaction.editReply({ embeds: [embed({ description: '🔒 Closing this ticket in 5 seconds…', color: C.warn })] });
  const settings = getGuild(ticket.guild_id);

  if (settings.ticket_log_channel) {
    const channel = interaction.guild.channels.cache.get(settings.ticket_log_channel);
    if (channel?.isTextBased()) {
      const file = await transcript(interaction.channel).catch(() => null);
      await channel
        .send({
          embeds: [
            embed({
              title: '🎫 Ticket closed',
              color: C.muted,
              fields: [
                field('Ticket', `#${ticket.id}`),
                field('Opened by', `<@${ticket.user_id}>`),
                field('Closed by', `<@${closer.id}>`),
                field('Opened', timestamp(ticket.created_at, 'R'), false),
              ],
            }),
          ],
          files: file ? [file] : [],
        })
        .catch(() => {});
    }
  }

  db.prepare('UPDATE tickets SET status = ?, closed_at = ? WHERE id = ?').run('closed', Date.now(), ticket.id);
  await logEvent(
    interaction.guild,
    'modlog_channel',
    modLogEmbed({ title: 'Ticket closed', description: `#${ticket.id} closed by ${closer.tag}`, color: C.muted }),
  );
  setTimeout(() => interaction.channel.delete(`Ticket #${ticket.id} closed`).catch(() => {}), 5000);
}

const components = {
  async 'ticket:open'(interaction) {
    const settings = getGuild(interaction.guild.id);
    if (!settings.ticket_category)
      return interaction.reply({ embeds: [fail('Tickets are not configured yet.')], flags: EPH });

    const existing = db
      .prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = ?')
      .get(interaction.guild.id, interaction.user.id, 'open');
    if (existing && interaction.guild.channels.cache.has(existing.channel_id))
      return interaction.reply({ embeds: [fail(`You already have an open ticket: <#${existing.channel_id}>`)], flags: EPH });

    await interaction.deferReply({ flags: EPH });

    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [P.ViewChannel], type: 0 },
      {
        id: interaction.user.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles],
        type: 1,
      },
      {
        id: interaction.client.user.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.AttachFiles],
        type: 1,
      },
    ];
    if (settings.ticket_staff_role)
      overwrites.push({
        id: settings.ticket_staff_role,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles],
        type: 0,
      });

    const count = (settings.ticket_count ?? 0) + 1;
    setGuild(interaction.guild.id, { ticket_count: count });

    const channel = await interaction.guild.channels.create({
      name: `ticket-${String(count).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent: settings.ticket_category,
      topic: `Ticket #${count} • ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: overwrites,
    });

    db.prepare('INSERT INTO tickets (guild_id, channel_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .run(interaction.guild.id, channel.id, interaction.user.id, Date.now());
    const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channel.id);

    await channel
      .send({
        content: `<@${interaction.user.id}>${settings.ticket_staff_role ? ` <@&${settings.ticket_staff_role}>` : ''}`,
        embeds: [
          embed({
            title: `Ticket #${ticket.id}`,
            description:
              `Thanks for reaching out, ${interaction.user}!\n\n` +
              'Please describe your issue in as much detail as you can — screenshots help.\n' +
              'A member of staff will be with you shortly.',
            color: C.ok,
          }),
        ],
        components: [
          row(
            btn.success('ticket:claim', 'Claim', '🙋'),
            btn.danger('ticket:close', 'Close', '🔒'),
          ),
        ],
      })
      .catch(() => {});

    return interaction.editReply({ embeds: [ok(`Your ticket is ready: ${channel}`)] });
  },

  async 'ticket:close'(interaction) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(interaction.channel.id);
    if (!ticket) return interaction.reply({ embeds: [fail('This is not a ticket channel.')], flags: EPH });
    if (interaction.user.id !== ticket.user_id && !interaction.member.permissions.has(P.ManageChannels))
      return interaction.reply({ embeds: [fail('Only the ticket owner or staff can close this.')], flags: EPH });

    await interaction.reply({ embeds: [embed({ description: '🔒 Closing this ticket in 5 seconds…', color: C.warn })] });
    const settings = getGuild(ticket.guild_id);
    if (settings.ticket_log_channel) {
      const channel = interaction.guild.channels.cache.get(settings.ticket_log_channel);
      if (channel?.isTextBased()) {
        const file = await transcript(interaction.channel).catch(() => null);
        await channel
          .send({
            embeds: [
              embed({
                title: '🎫 Ticket closed',
                color: C.muted,
                fields: [
                  field('Ticket', `#${ticket.id}`),
                  field('Opened by', `<@${ticket.user_id}>`),
                  field('Closed by', `${interaction.user}`),
                ],
              }),
            ],
            files: file ? [file] : [],
          })
          .catch(() => {});
      }
    }
    db.prepare('UPDATE tickets SET status = ?, closed_at = ? WHERE id = ?').run('closed', Date.now(), ticket.id);
    setTimeout(() => interaction.channel.delete(`Ticket closed`).catch(() => {}), 5000);
  },

  async 'ticket:claim'(interaction) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(interaction.channel.id);
    if (!ticket) return interaction.reply({ embeds: [fail('This is not a ticket channel.')], flags: EPH });
    if (!interaction.member.permissions.has(P.ManageChannels) && !interaction.member.roles.cache.has(getGuild(interaction.guild.id).ticket_staff_role))
      return interaction.reply({ embeds: [fail('Only staff can claim tickets.')], flags: EPH });

    db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run(interaction.user.id, ticket.id);
    return interaction.reply({ embeds: [ok(`🙋 ${interaction.user} claimed this ticket.`)] });
  },
};

export default { category, commands, components };
