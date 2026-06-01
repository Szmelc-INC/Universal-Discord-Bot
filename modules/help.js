const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const CATEGORY_MAP = {
  rm: 'Admin',
  shell: 'Admin',
  yt: 'Admin',
  upload: 'Admin',
  dm: 'Admin',
  role: 'Admin',
  reload: 'Admin',
  modules: 'Admin',
  settings: 'Admin',
  presence: 'Admin',
  webhooks: 'Admin',

  info: 'Utility',
  image: 'Fun',
  joke: 'Fun',
  quote: 'Fun',
  rng: 'Fun',
  crypto: 'Utility',
  ping: 'Utility',
  game: 'Fun',
  anon: 'Utility',
  audio: 'Utility',
  tictactoe: 'Fun',
  music: 'Utility'
};

function getCategory(name) {
  return CATEGORY_MAP[name] || 'Other';
}

function formatOption(opt) {
  const required = opt.required ? '' : '?';
  return `${opt.name}${required}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands and usage')
    .addStringOption(o =>
      o.setName('command')
        .setDescription('Get detailed help for a specific command')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const cmds = [...interaction.client.commands.keys()]
      .filter(n => n.includes(focused))
      .slice(0, 25);
    await interaction.respond(cmds.map(c => ({ name: c, value: c })));
  },

  async execute(interaction) {
    const specific = interaction.options.getString('command');
    const commands = [...interaction.client.commands.values()];

    if (specific) {
      const cmd = commands.find(c => c.data.name === specific);
      if (!cmd) {
        await interaction.reply({ content: `Command \`${specific}\` not found.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`/${cmd.data.name}`)
        .setDescription(cmd.data.description || 'No description')
        .setColor(0x5865F2);

      try {
        const json = cmd.data.toJSON();
        if (json.options && json.options.length) {
          const opts = json.options.map(o => {
            if (o.type === 1) return `• **${o.name}** — ${o.description}`;
            return `• **${o.name}**${o.required ? '' : ' (optional)'} — ${o.description}`;
          });
          embed.addFields({ name: 'Options / Subcommands', value: opts.join('\n').slice(0, 1000) });
        }
      } catch {}

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // Grouped list
    const grouped = {};
    for (const cmd of commands) {
      const cat = getCategory(cmd.data.name);
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(`**/${cmd.data.name}** — ${cmd.data.description || ''}`);
    }

    const embed = new EmbedBuilder()
      .setTitle('Universal Discord Bot — Help')
      .setDescription('Use `/help <command>` for details on a specific command.\nAdmin commands require appropriate permissions.')
      .setColor(0x5865F2);

    for (const [cat, lines] of Object.entries(grouped)) {
      embed.addFields({
        name: cat,
        value: lines.join('\n').slice(0, 1000) || '—',
        inline: false
      });
    }

    await interaction.client.sendWithLimits(interaction, '', { embeds: [embed] });
  }
};
