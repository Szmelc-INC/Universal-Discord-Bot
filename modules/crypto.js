const { SlashCommandBuilder } = require('discord.js');

const API_KEY = '8af4164f-ccf2-4463-86f7-aeaf2d6f7f1d';

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: {
      'Accepts': 'application/json',
      'X-CMC_PRO_API_KEY': API_KEY
    }
  });
  return res.json();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crypto')
    .setDescription('Show crypto prices')
    .addStringOption(o => o.setName('symbol').setDescription('Symbol or TOP10').setRequired(false)),
  async execute(interaction) {
    const symbol = (interaction.options.getString('symbol') || 'TOP10').toUpperCase();
    try {
      if (symbol === 'TOP10') {
        const data = await fetchJSON('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=10&convert=PLN');
        if (data.status.error_code !== 0) throw new Error('API error');
        const msg = data.data.map(c => `${c.name} (${c.symbol}): ${c.quote.PLN.price.toFixed(2)} PLN`).join('\n');
        await interaction.reply(`Top 10 Cryptocurrencies:\n${msg}`);
      } else {
        const data = await fetchJSON(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbol}&convert=PLN`);
        if (data.status.error_code !== 0) throw new Error('API error');
        const price = data.data[symbol].quote.PLN.price;
        await interaction.reply(`The current price of ${symbol} is ${price.toFixed(2)} PLN.`);
      }
    } catch (e) {
      await interaction.reply(`Error fetching price: ${e.message}`);
    }
  }
};
