const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Manage roles')
    .addSubcommand(sc => sc
      .setName('add')
      .setDescription('Add a role to a member')
      .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(sc => sc
      .setName('remove')
      .setDescription('Remove a role from a member')
      .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(sc => sc
      .setName('list')
      .setDescription('List roles of a member')
      .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))),
  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Unauthorized.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    const member = interaction.options.getMember('member');
    const role = interaction.options.getRole('role');
    try {
      if (sub === 'add') {
        if (member.roles.cache.has(role.id)) {
          await interaction.reply(`${member.displayName} already has the role ${role.name}.`);
        } else {
          await member.roles.add(role);
          await interaction.reply(`Successfully added role ${role.name} to ${member.displayName}.`);
        }
      } else if (sub === 'remove') {
        if (!member.roles.cache.has(role.id)) {
          await interaction.reply(`${member.displayName} does not have the role ${role.name}.`);
        } else {
          await member.roles.remove(role);
          await interaction.reply(`Successfully removed role ${role.name} from ${member.displayName}.`);
        }
      } else if (sub === 'list') {
        const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name);
        await interaction.reply(roles.length ? `${member.displayName} has the following roles: ${roles.join(', ')}` : `${member.displayName} has no roles.`);
      }
    } catch (e) {
      await interaction.reply(`An error occurred: ${e.message || e}`);
    }
  }
};
