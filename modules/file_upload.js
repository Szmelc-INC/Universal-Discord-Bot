const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('upload')
    .setDescription('Upload a local file to a channel (admin)')
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('filepath').setDescription('Path to file on host').setRequired(true)),
  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Unauthorized.', flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = interaction.options.getChannel('channel');
    const filepath = path.resolve(interaction.options.getString('filepath'));
    if (!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) {
      await interaction.reply({ content: `File not found: \`${filepath}\``, flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      await channel.send({ files: [{ attachment: filepath, name: path.basename(filepath) }] });
      await interaction.reply(`Uploaded \`${path.basename(filepath)}\` to ${channel}.`);
    } catch (e) {
      await interaction.reply(`Upload failed: ${e.message || e}`);
    }
  }
};
