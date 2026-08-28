const { SlashCommandBuilder } = require('discord.js');
const { customId, parseCustomId, buttons } = require('../lib/interactions');

const MODULE = 'rng';
const rerollRow = (type, max) => buttons([{ id: customId(MODULE, 'reroll', `${type}:${max ?? ''}`), label: 'Losuj ponownie', style: 'secondary', emoji: '🔄' }]);

function roll(type, max) {
  if (type === 'coinflip') {
    return `🪙 ${Math.random() < 0.495 ? 'Heads' : Math.random() < 0.99 ? 'Tails' : 'Edge'}`;
  }
  if (type === 'diceroll') {
    const sides = [6, 20].includes(max) ? max : 6;
    return `🎲 ${Math.floor(Math.random() * sides) + 1} (d${sides})`;
  }
  if (type === 'number') {
    const cap = max || 100;
    return `🔢 ${Math.floor(Math.random() * cap) + 1}`;
  }
  if (type === 'randomstring') {
    const len = Math.min(Math.max(max || 16, 1), 128);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return `\`${s}\``;
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rng')
    .setDescription('Random generators')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type of generator')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option.setName('max')
        .setDescription('Max / length / sides')
        .setRequired(false)
    ),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const choices = ['coinflip', 'diceroll', 'number', 'randomstring'];
    const filtered = choices.filter(choice => choice.startsWith(focused));
    await interaction.respond(filtered.map(choice => ({ name: choice, value: choice })));
  },
  async execute(interaction) {
    const type = interaction.options.getString('type');
    const max = interaction.options.getInteger('max');
    const result = roll(type, max);
    if (result == null) {
      await interaction.reply('Unknown type');
      return;
    }
    await interaction.reply({ content: result, components: rerollRow(type, max) });
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "rng:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { payload } = parseCustomId(interaction.customId);
    const [type, maxStr] = payload.split(':');
    const max = maxStr ? Number(maxStr) : undefined;
    const result = roll(type, max);
    await interaction.update({ content: result ?? 'Unknown type', components: result != null ? rerollRow(type, max) : [] });
  }
};
