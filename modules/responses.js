const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const RESPONSES_FILE = path.join(__dirname, '..', 'misc', 'responses.txt');
const DEFAULT_CHANCE = 0.35;

function loadResponses() {
  const responses = {};
  try {
    const content = fs.readFileSync(RESPONSES_FILE, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [keyword, responseStr] = trimmed.split(':', 2);
      if (keyword && responseStr) {
        responses[keyword.toLowerCase().trim()] = responseStr
          .split(',')
          .map(r => r.trim())
          .filter(Boolean);
      }
    }
  } catch (e) {
    console.error('[responses] Failed to load responses.txt:', e.message);
  }
  return responses;
}

let responsesMap = {};
let responseChance = DEFAULT_CHANCE;

module.exports = {
  // This module does not register a slash command by default.
  // It works passively via message listener.

  init(client) {
    // Load responses on init
    responsesMap = loadResponses();

    // Allow runtime chance override via settings if present
    const customChance = client.config?.values?.responseChance;
    if (typeof customChance === 'number' && customChance >= 0 && customChance <= 1) {
      responseChance = customChance;
    }

    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (!client.isModuleEnabled('responses')) return;

      // Only respond with a certain probability
      if (Math.random() > responseChance) return;

      const content = message.content.toLowerCase();

      for (const keyword in responsesMap) {
        if (content.includes(keyword)) {
          const possibleReplies = responsesMap[keyword];
          if (possibleReplies && possibleReplies.length > 0) {
            const reply = possibleReplies[Math.floor(Math.random() * possibleReplies.length)];
            try {
              await message.channel.send(reply);
            } catch (err) {
              console.error('[responses] Failed to send reply:', err.message);
            }
          }
          break; // Only trigger one response per message
        }
      }
    });

    console.log('[responses] Keyword responder initialized');
  },

  // Optional slash command to manage responses
  data: new SlashCommandBuilder()
    .setName('responses')
    .setDescription('Manage the auto-response system (admin)')
    .addSubcommand(sc => sc.setName('reload').setDescription('Reload responses from file'))
    .addSubcommand(sc =>
      sc.setName('chance')
        .setDescription('Set the chance (0.0 - 1.0) that the bot responds')
        .addNumberOption(o =>
          o.setName('value')
            .setDescription('Probability (e.g. 0.35 = 35%)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(1)
        )
    )
    .addSubcommand(sc => sc.setName('list').setDescription('Show currently loaded keywords')),

  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'reload') {
      responsesMap = loadResponses();
      await interaction.reply({ content: `Reloaded responses. ${Object.keys(responsesMap).length} keywords loaded.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'chance') {
      const value = interaction.options.getNumber('value');
      responseChance = value;

      // Persist in config.values if possible
      if (interaction.client.config) {
        if (!interaction.client.config.values) interaction.client.config.values = {};
        interaction.client.config.values.responseChance = value;
        interaction.client.saveConfig?.();
      }

      await interaction.reply({ content: `Response chance set to ${(value * 100).toFixed(0)}%`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'list') {
      const keywords = Object.keys(responsesMap);
      if (keywords.length === 0) {
        await interaction.reply('No responses loaded.');
        return;
      }
      const list = keywords.map(k => `• \`${k}\` (${responsesMap[k].length} replies)`).join('\n');
      await interaction.client.sendWithLimits(interaction, `**Loaded keywords:**\n${list}`);
      return;
    }
  }
};
