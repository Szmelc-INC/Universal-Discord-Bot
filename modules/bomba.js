const { SlashCommandBuilder } = require('discord.js');

async function fetchQuote() {
  try {
    const res = await fetch('https://nonsa.pl/wiki/Cytaty:Kapitan_Bomba');
    const html = await res.text();
    const matches = [...html.matchAll(/<li>\s*<i>(.*?)<\/i>/gs)];
    if (matches.length === 0) return 'No quotes found.';
    const quote = matches[Math.floor(Math.random() * matches.length)][1]
      .replace(/<.*?>/g, '')
      .trim();
    return quote || 'No quote available.';
  } catch (e) {
    return `Error fetching quote: ${e}`;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bomba')
    .setDescription('Random Kapitan Bomba quote'),
  async execute(interaction) {
    const quote = await fetchQuote();
    await interaction.reply(quote);
  }
};
