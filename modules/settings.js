const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

function getValue(obj, path) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function setValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]] || typeof current[keys[i]] !== 'object') current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Manage bot settings (admin only)')
    .addSubcommand(sc => sc.setName('list').setDescription('List all current settings'))
    .addSubcommand(sc =>
      sc.setName('get')
        .setDescription('Get a specific setting')
        .addStringOption(o => o.setName('key').setDescription('Setting path e.g. limits.maxMessageLength').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('set')
        .setDescription('Change a setting (saves immediately)')
        .addStringOption(o => o.setName('key').setDescription('Setting path').setRequired(true))
        .addStringOption(o => o.setName('value').setDescription('New value (JSON for objects/arrays)').setRequired(true))
    )
    .addSubcommand(sc => sc.setName('reload').setDescription('Reload settings from disk')),

  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const client = interaction.client;

    if (sub === 'list') {
      const cfg = client.config || {};
      const botCfg = client.botConfig || {};

      const embed = new EmbedBuilder()
        .setTitle('Current Settings')
        .setColor(0x57F287)
        .addFields(
          { name: 'Admins', value: JSON.stringify(cfg.admins || [], null, 0) },
          { name: 'Admin Roles', value: JSON.stringify(cfg.adminRoles || [], null, 0) },
          { name: 'Limits', value: '```json\n' + JSON.stringify(cfg.limits || {}, null, 2).slice(0, 900) + '\n```' },
          { name: 'This Bot Config', value: '```json\n' + JSON.stringify(botCfg, null, 2).slice(0, 900) + '\n```' }
        );

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'get') {
      const key = interaction.options.getString('key');
      const val = getValue(client.config, key) ?? getValue(client.botConfig, key);
      await interaction.reply({ content: `\`${key}\` = \`${JSON.stringify(val)}\``, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'set') {
      const key = interaction.options.getString('key');
      const raw = interaction.options.getString('value');

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw; // treat as plain string
      }

      // Try top level config first, then botConfig
      const top = getValue(client.config, key);
      if (top !== undefined) {
        setValue(client.config, key, parsed);
      } else {
        setValue(client.botConfig, key, parsed);
      }

      client.saveConfig();
      await interaction.reply({ content: `Set \`${key}\` = \`${JSON.stringify(parsed)}\` (saved to disk)`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'reload') {
      try {
        delete require.cache[require.resolve(client.configPath)];
        const fresh = require(client.configPath);
        Object.assign(client.config, fresh);
        await interaction.reply({ content: 'Settings reloaded from disk.', flags: MessageFlags.Ephemeral });
      } catch (e) {
        await interaction.reply({ content: `Reload failed: ${e.message}`, flags: MessageFlags.Ephemeral });
      }
      return;
    }
  }
};
