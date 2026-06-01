const { SlashCommandBuilder, ActivityType, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const PRESENCE_FILE = path.join(__dirname, '..', 'config', 'bot-presence.json');

function loadSavedPresence() {
  try {
    if (fs.existsSync(PRESENCE_FILE)) {
      return JSON.parse(fs.readFileSync(PRESENCE_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function savePresence(data) {
  try {
    fs.mkdirSync(path.dirname(PRESENCE_FILE), { recursive: true });
    fs.writeFileSync(PRESENCE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[presence] Failed to save presence:', e.message);
  }
}

const ACTIVITY_TYPE_MAP = {
  playing: ActivityType.Playing,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  streaming: ActivityType.Streaming,
  custom: ActivityType.Custom,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('presence')
    .setDescription('Control the bot\'s rich presence / activity (admin only)')
    .addSubcommand(sc =>
      sc.setName('set')
        .setDescription('Set the bot\'s activity')
        .addStringOption(o => o.setName('type')
          .setDescription('Activity type')
          .setRequired(true)
          .addChoices(
            { name: 'Playing', value: 'playing' },
            { name: 'Listening', value: 'listening' },
            { name: 'Watching', value: 'watching' },
            { name: 'Competing', value: 'competing' },
            { name: 'Streaming', value: 'streaming' },
            { name: 'Custom', value: 'custom' }
          ))
        .addStringOption(o => o.setName('text').setDescription('Activity text / name').setRequired(true))
        .addStringOption(o => o.setName('url').setDescription('Stream URL (only for Streaming type)')))
    .addSubcommand(sc => sc.setName('clear').setDescription('Clear the bot\'s current activity'))
    .addSubcommand(sc => sc.setName('status').setDescription('Show current bot presence')),

  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'You are not authorized to use this command.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const typeStr = interaction.options.getString('type');
      const text = interaction.options.getString('text');
      const url = interaction.options.getString('url');

      const activityType = ACTIVITY_TYPE_MAP[typeStr] ?? ActivityType.Playing;

      const presenceData = {
        activities: [{
          name: text,
          type: activityType,
          url: typeStr === 'streaming' ? url : undefined,
        }],
        status: 'online',
      };

      try {
        await interaction.client.user.setPresence(presenceData);
        savePresence({ type: typeStr, text, url: url || null });

        await interaction.reply({ content: `Presence updated to **${typeStr}** ${text}`, flags: MessageFlags.Ephemeral });
      } catch (e) {
        await interaction.reply({ content: `Failed to set presence: ${e.message}`, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'clear') {
      try {
        await interaction.client.user.setPresence({ activities: [] });
        if (fs.existsSync(PRESENCE_FILE)) fs.unlinkSync(PRESENCE_FILE);
        await interaction.reply({ content: 'Bot presence cleared.', flags: MessageFlags.Ephemeral });
      } catch (e) {
        await interaction.reply({ content: `Failed to clear: ${e.message}`, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'status') {
      const current = interaction.client.user.presence?.activities?.[0];
      if (!current) {
        await interaction.reply({ content: 'No custom activity is currently set.', flags: MessageFlags.Ephemeral });
        return;
      }
      const saved = loadSavedPresence();
      let msg = `**Current Activity:**\nType: ${ActivityType[current.type] ?? current.type}\nText: ${current.name}`;
      if (saved) msg += `\nSaved: ${saved.type} - ${saved.text}`;
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      return;
    }
  }
};
