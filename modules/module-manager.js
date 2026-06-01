const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modules')
    .setDescription('Manage bot modules at runtime (admin only)')
    .addSubcommand(sc => sc.setName('list').setDescription('List all modules and their status'))
    .addSubcommand(sc =>
      sc.setName('enable')
        .setDescription('Enable a module')
        .addStringOption(o => o.setName('name').setDescription('Module name (without .js)').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sc =>
      sc.setName('disable')
        .setDescription('Disable a module')
        .addStringOption(o => o.setName('name').setDescription('Module name (without .js)').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sc => sc.setName('reload').setDescription('Reload all modules and commands')),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'enable' && sub !== 'disable') return;

    const focused = interaction.options.getFocused().toLowerCase();
    const all = interaction.client.getAllModuleNames();
    const filtered = all.filter(n => n.includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(n => ({ name: n, value: n })));
  },

  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const client = interaction.client;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const all = client.getAllModuleNames();
      const lines = all.map(name => {
        const enabled = client.isModuleEnabled(name);
        const loaded = client.commands.has(name);
        const status = enabled ? (loaded ? '✅ enabled' : '⚠️ enabled but not loaded') : '❌ disabled';
        return `\`${name}\` — ${status}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('Module Status')
        .setDescription(lines.join('\n').slice(0, 4000) || 'No modules found')
        .setColor(0x5865F2);

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'enable') {
      const name = interaction.options.getString('name');
      if (!client.getAllModuleNames().includes(name)) {
        await interaction.reply({ content: `Module \`${name}\` does not exist.`, flags: MessageFlags.Ephemeral });
        return;
      }
      client.enableModule(name);
      await client.reloadAll();
      await interaction.reply({ content: `✅ Enabled \`${name}\` and reloaded commands.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'disable') {
      const name = interaction.options.getString('name');
      if (name === 'reload' || name === 'modules' || name === 'settings') {
        await interaction.reply({ content: 'You cannot disable critical admin modules.', flags: MessageFlags.Ephemeral });
        return;
      }
      client.disableModule(name);
      await client.reloadAll();
      await interaction.reply({ content: `❌ Disabled \`${name}\` and reloaded commands.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'reload') {
      await interaction.reply({ content: 'Reloading all modules...', flags: MessageFlags.Ephemeral });
      try {
        await client.reloadAll();
        await interaction.editReply('✅ Modules reloaded.');
      } catch (e) {
        await interaction.editReply(`Reload failed: ${e.message}`);
      }
      return;
    }
  }
};
