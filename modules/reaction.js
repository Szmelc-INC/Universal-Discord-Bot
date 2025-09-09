const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reaction')
    .setDescription('Reaction role management is not implemented in this branch'),
  async execute(interaction) {
    await interaction.reply('Reaction role functionality is not available.');
  }
};
