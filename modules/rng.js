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
        .setDescription('Max value for number type')
        .setRequired(false)
    ),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const choices = ['coinflip', 'diceroll', 'number'];
    const filtered = choices.filter(choice => choice.startsWith(focused));
    await interaction.respond(filtered.map(choice => ({ name: choice, value: choice })));
  },
  async execute(interaction) {
    const type = interaction.options.getString('type');
    if (type === 'coinflip') {
      const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
      await interaction.reply(`🪙 ${result}`);
    } else if (type === 'diceroll') {
      const roll = Math.ceil(Math.random() * 6);
      await interaction.reply(`🎲 ${roll}`);
    } else if (type === 'number') {
      const max = interaction.options.getInteger('max') || 100;
      const num = Math.floor(Math.random() * max) + 1;
      await interaction.reply(`🔢 ${num}`);
    } else {
      await interaction.reply('Unknown type');
    }
  }
};
