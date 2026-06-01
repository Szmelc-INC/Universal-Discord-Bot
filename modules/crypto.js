const { SlashCommandBuilder } = require('discord.js');

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error('API error ' + res.status);
  return res.json();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crypto')
    .setDescription('Show cryptocurrency prices (via CoinGecko)')
    .addStringOption(o => o.setName('symbol').setDescription('e.g. bitcoin, ethereum or TOP').setRequired(false)),
  async execute(interaction) {
    const sym = (interaction.options.getString('symbol') || 'top').toLowerCase();
    try {
      if (sym === 'top' || sym === 'TOP10' || sym === 'top10') {
        const data = await fetchJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1');
        const msg = data.map(c => `${c.name} (${c.symbol.toUpperCase()}): $${c.current_price}`).join('\n');
        await interaction.client.sendWithLimits(interaction, `Top coins:\n${msg}`);
      } else {
        const data = await fetchJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(sym)}&vs_currencies=usd`);
        const key = Object.keys(data)[0];
        if (!key || !data[key]) throw new Error('Unknown symbol');
        await interaction.reply(`${key}: $${data[key].usd}`);
      }
    } catch (e) {
      await interaction.reply(`Error: ${e.message || 'failed to fetch'}`);
    }
  }
};
