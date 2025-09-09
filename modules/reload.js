const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Reload all bot commands'),
  async execute(interaction) {
    const config = interaction.client.config || {};
    const admins = config.admins || [];
    const adminRoles = config.adminRoles || [];
    const member = interaction.member;
    const isAdmin = admins.includes(interaction.user.id) || (member && member.roles.cache.some(r => adminRoles.includes(r.id)));
    if (!isAdmin) {
      return interaction.reply({ content: 'Unauthorized', ephemeral: true });
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
