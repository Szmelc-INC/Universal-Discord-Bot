const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Reload all bot commands'),
  async execute(interaction) {
    const isAdmin = interaction.client.isAdmin(interaction.member || interaction.user);
    if (!isAdmin) {
      return interaction.reply({ content: 'Unauthorized', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply('Reloading...');
    try {
      await interaction.client.reloadAll();
      await interaction.editReply('Reload complete');
    } catch (e) {
      await interaction.editReply('Reload failed');
      console.error(e);
    }
  }
};
