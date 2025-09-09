const { SlashCommandBuilder } = require('discord.js');

async function fetchQuote() {
  try {
    const res = await fetch('https://egzorcysta.fandom.com/wiki/Bogdan_Boner');
    const html = await res.text();
    const matches = [...html.matchAll(/<li>(.*?)<\/li>/gs)];
    if (matches.length === 0) return 'No quotes found.';
    const cleaned = matches.map(m => m[1].replace(/<.*?>/g, '').split('(')[0].trim()).filter(Boolean);
    if (!cleaned.length) return 'No quotes found.';
    return cleaned[Math.floor(Math.random() * cleaned.length)];
  } catch (e) {
    return `Error: ${e}`;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boner')
    .setDescription('Random Bogdan Boner quote'),
  async execute(interaction) {
    const quote = await fetchQuote();
    await interaction.reply(quote);
  }
};
