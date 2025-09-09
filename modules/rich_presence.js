const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('richpresence')
    .setDescription('Rich presence control is not implemented in this branch'),
  async execute(interaction) {
    await interaction.reply('Rich presence is not available.');
  }
};
