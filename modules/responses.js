const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('responses')
    .setDescription('Keyword responses are not implemented in this branch'),
  async execute(interaction) {
    await interaction.reply('Automated responses are not available.');
  }
};
