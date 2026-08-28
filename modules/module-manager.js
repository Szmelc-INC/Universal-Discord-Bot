const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { customId, parseCustomId, notice, selectMenu } = require('../lib/interactions');

const MODULE = 'modules';
// getAllModuleNames() returns *file* names (module-manager.js -> "module-manager"),
// not command names — "modules" here would never match and leave this file disableable.
const CRITICAL = ['reload', 'module-manager', 'settings'];

function listPayload(client) {
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

  const rows = all.length
    ? [selectMenu({
        id: customId(MODULE, 'pick'),
        placeholder: 'Przełącz moduł (enable/disable)…',
        options: all.slice(0, 25).map(n => ({
          label: n,
          value: n,
          description: CRITICAL.includes(n)
            ? 'krytyczny — nie można wyłączyć'
            : (client.isModuleEnabled(n) ? 'enabled — kliknij by wyłączyć' : 'disabled — kliknij by włączyć')
        }))
      })]
    : [];
  return { embeds: [embed], components: rows };
}

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
      await interaction.reply({ ...listPayload(client), flags: MessageFlags.Ephemeral });
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
      if (CRITICAL.includes(name)) {
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
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "modules:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await notice(interaction, 'Admin only.');
      return;
    }

    const { action } = parseCustomId(interaction.customId);
    const client = interaction.client;

    if (action === 'pick') {
      const name = interaction.values[0];
      if (CRITICAL.includes(name)) {
        await notice(interaction, 'Nie można wyłączyć krytycznych modułów (reload/modules/settings).');
        return;
      }
      await interaction.deferUpdate();
      if (client.isModuleEnabled(name)) client.disableModule(name);
      else client.enableModule(name);
      await client.reloadAll();
      await interaction.editReply(listPayload(client));
    }
  }
};
