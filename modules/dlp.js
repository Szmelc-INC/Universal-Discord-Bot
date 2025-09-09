const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dlp')
    .setDescription('Download media using yt-dlp (not implemented)')
    .addStringOption(o => o.setName('format').setDescription('mp3 or mp4').setRequired(true))
    .addStringOption(o => o.setName('url').setDescription('Media URL').setRequired(true)),
  async execute(interaction) {
    await interaction.reply('yt-dlp functionality is not available in the Node.js version yet.');
  }
};
