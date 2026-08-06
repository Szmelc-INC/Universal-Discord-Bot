const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a direct message as the bot')
    .addUserOption(o => o.setName('user').setDescription('User to DM').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message content').setRequired(true)),
  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Unauthorized.', flags: MessageFlags.Ephemeral });
      return;
    }
    const user = interaction.options.getUser('user');
    const msg = interaction.options.getString('message');
    try {
      await user.send(msg);
      await interaction.reply(`Message sent to ${user.tag}`);
    } catch (e) {
      await interaction.reply(`Failed to send DM: ${e.message || e}`);
    }
  }
};
