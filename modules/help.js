const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { customId, parseCustomId, reply, updatePanel, notice, buttons, selectMenu } = require('../lib/interactions');

const MODULE = 'help';

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

function commandDetailEmbed(cmd) {
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
  return embed;
}

function groupedPayload(client) {
  const commands = [...client.commands.values()];
  const grouped = {};
  for (const cmd of commands) {
    const cat = getCategory(cmd.data.name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(`**/${cmd.data.name}** — ${cmd.data.description || ''}`);
  }

  const embed = new EmbedBuilder()
    .setTitle('Universal Discord Bot — Help')
    .setDescription('Wybierz komendę z listy poniżej, albo użyj `/help <command>`.\nKomendy administracyjne wymagają odpowiednich uprawnień.')
    .setColor(0x5865F2);
  for (const [cat, lines] of Object.entries(grouped)) {
    embed.addFields({ name: cat, value: lines.join('\n').slice(0, 1000) || '—', inline: false });
  }

  const names = commands.map(c => c.data.name).sort();
  const rows = names.length
    ? [selectMenu({
        id: customId(MODULE, 'view'),
        placeholder: 'Zobacz szczegóły komendy…',
        options: names.slice(0, 25).map(n => ({ label: `/${n}`, value: n }))
      })]
    : [];
  return { content: '', embeds: [embed], components: rows };
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
      await interaction.reply({ embeds: [commandDetailEmbed(cmd)], flags: MessageFlags.Ephemeral });
      return;
    }

    await reply(interaction, groupedPayload(interaction.client));
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "help:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { action } = parseCustomId(interaction.customId);

    if (action === 'view') {
      const cmd = interaction.client.commands.get(interaction.values[0]);
      if (!cmd) {
        await notice(interaction, 'Ta komenda już nie istnieje (moduły mogły zostać przeładowane).');
        return;
      }
      const backRow = buttons([{ id: customId(MODULE, 'back'), label: '⬅ Powrót do listy', style: 'secondary' }]);
      await updatePanel(interaction, { content: '', embeds: [commandDetailEmbed(cmd)], components: backRow });
      return;
    }

    if (action === 'back') {
      await updatePanel(interaction, groupedPayload(interaction.client));
    }
  }
};
