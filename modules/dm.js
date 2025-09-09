const { SlashCommandBuilder } = require('discord.js');

const ADMIN_ID = '818166724641030193';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a direct message as the bot')
    .addUserOption(o => o.setName('user').setDescription('User to DM').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message content').setRequired(true)),
  async execute(interaction) {
    if (interaction.user.id !== ADMIN_ID) {
      await interaction.reply('You are not authorized to use this command.');
      return;
    }
    const user = interaction.options.getUser('user');
    const msg = interaction.options.getString('message');
    try {
      await user.send(msg);
      await interaction.reply(`Message sent to ${user.tag}`);
    } catch (e) {
      await interaction.reply(`Failed to send DM: ${e}`);
    }
  }
};
