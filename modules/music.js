const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music playback is not implemented in the Node.js version'),
  async execute(interaction) {
    await interaction.reply('Music module is not available in this branch.');
  }
};
