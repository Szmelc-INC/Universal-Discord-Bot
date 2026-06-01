const { SlashCommandBuilder } = require('discord.js');

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
    if (type === 'coinflip') {
      const result = Math.random() < 0.495 ? 'Heads' : Math.random() < 0.99 ? 'Tails' : 'Edge';
      await interaction.reply(`🪙 ${result}`);
    } else if (type === 'diceroll') {
      const max = interaction.options.getInteger('max') || 6;
      const sides = [6, 20].includes(max) ? max : 6;
      const roll = Math.floor(Math.random() * sides) + 1;
      await interaction.reply(`🎲 ${roll} (d${sides})`);
    } else if (type === 'number') {
      const max = interaction.options.getInteger('max') || 100;
      const num = Math.floor(Math.random() * max) + 1;
      await interaction.reply(`🔢 ${num}`);
    } else if (type === 'randomstring') {
      const len = Math.min(Math.max(interaction.options.getInteger('max') || 16, 1), 128);
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let s = '';
      for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
      await interaction.reply(`\`${s}\``);
    } else {
      await interaction.reply('Unknown type');
    }
  }
};
