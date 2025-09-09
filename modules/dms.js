const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dms')
    .setDescription('DM logging is not supported in the Node.js version'),
  async execute(interaction) {
    await interaction.reply('DM logging is not available in this branch.');
  }
};
