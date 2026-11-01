import { SlashCommandBuilder, PermissionFlagsBits as P } from 'discord.js';
import { config } from '../config.js';
import { embed, ok, fail, C, EPH } from '../lib/ui.js';
import { truncate, fetchJson } from '../lib/helpers.js';

const category = 'AI';

/** Per-channel conversations, capped so memory cannot run away. */
const conversations = new Map();
const MAX_TURNS = 10;

const SYSTEM_PROMPT =
  'You are Nexus, a helpful Discord bot assistant. Answer concisely (under 1500 characters), ' +
  'use plain text or light markdown, and never invent facts about the server you cannot know.';

const configured = () => Boolean(config.ai.baseUrl && config.ai.apiKey);

async function ask(messages) {
  const url = `${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const data = await fetchJson(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 700,
        temperature: 0.7,
      }),
    },
    30000,
  );
  return data?.choices?.[0]?.message?.content?.trim() ?? '';
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('ai')
      .setDescription('Chat with an AI assistant (needs AI_BASE_URL + AI_API_KEY)')
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('ask')
          .setDescription('Ask the assistant something')
          .addStringOption((o) => o.setName('prompt').setDescription('Your question').setRequired(true).setMaxLength(1500)),
      )
      .addSubcommand((s) => s.setName('reset').setDescription('Forget the conversation in this channel')),
    async execute(interaction) {
      if (!configured())
        return interaction.editReply({
          embeds: [
            fail(
              'The AI module is not configured.\n\nSet these environment variables and restart:\n' +
                '```\nAI_BASE_URL=https://api.openai.com/v1\nAI_API_KEY=sk-...\nAI_MODEL=gpt-4o-mini\n```\n' +
                'Any OpenAI-compatible endpoint works (OpenAI, Groq, OpenRouter, Ollama, LM Studio).',
              'AI disabled',
            ),
          ],
        });

      if (interaction.options.getSubcommand() === 'reset') {
        conversations.delete(interaction.channel.id);
        return interaction.editReply({ embeds: [ok('Conversation cleared.')] });
      }

      const prompt = interaction.options.getString('prompt');
      const history = conversations.get(interaction.channel.id) ?? [];
      const messages = [...history, { role: 'user', content: `${interaction.user.username}: ${prompt}` }];

      let answer;
      try {
        answer = await ask(messages);
      } catch (err) {
        return interaction.editReply({ embeds: [fail(`The AI request failed: ${err.message}`)] });
      }
      if (!answer) return interaction.editReply({ embeds: [fail('The model returned an empty response.')] });

      const nextHistory = [...messages, { role: 'assistant', content: answer }].slice(-MAX_TURNS * 2);
      conversations.set(interaction.channel.id, nextHistory);
      if (conversations.size > 500) conversations.delete(conversations.keys().next().value);

      return interaction.editReply({
        embeds: [
          embed({
            author: { name: `${interaction.user.username} asked`, icon_url: interaction.user.displayAvatarURL() },
            description: truncate(answer, 3900),
            color: C.brand,
            footer: { text: `${config.ai.model} • /ai reset to start over` },
          }),
        ],
      });
    },
  },
];

export default { category, commands };
