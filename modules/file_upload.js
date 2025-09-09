const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ALLOWED_ID = '818166724641030193';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('upload')
    .setDescription('Upload a local file to a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('filepath').setDescription('Path to file').setRequired(true)),
  async execute(interaction) {
    if (interaction.user.id !== ALLOWED_ID) {
      await interaction.reply('You are not sernik. Wypierdalaj');
      return;
    }
    const channel = interaction.options.getChannel('channel');
    const filepath = path.resolve(interaction.options.getString('filepath'));
    if (!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) {
      await interaction.reply(`The file \`${filepath}\` I see no shit.`);
      return;
    }
    try {
      await channel.send({ files: [filepath] });
      await interaction.reply(`Plik \`${filepath}\` wrzucony na ${channel}.`);
    } catch (e) {
      await interaction.reply(`Coś się zjebało: ${e}`);
    }
  }
};
