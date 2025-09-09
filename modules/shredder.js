const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rm')
    .setDescription('Message cleanup is not implemented in this branch')
    .addStringOption(o => o.setName('target').setDescription('Target').setRequired(false))
    .addStringOption(o => o.setName('time').setDescription('Time frame').setRequired(false)),
  async execute(interaction) {
    await interaction.reply('Cleanup functionality is not available.');
  }
};
