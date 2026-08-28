const { SlashCommandBuilder } = require('discord.js');
const { customId, parseCustomId, buttons } = require('../lib/interactions');

const MODULE = 'crypto';
const refreshRow = sym => buttons([{ id: customId(MODULE, 'refresh', sym), label: 'Odśwież', style: 'secondary', emoji: '🔄' }]);

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error('API error ' + res.status);
  return res.json();
}

async function priceText(sym) {
  if (sym === 'top' || sym === 'top10') {
    const data = await fetchJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1');
    const msg = data.map(c => `${c.name} (${c.symbol.toUpperCase()}): $${c.current_price}`).join('\n');
    return `Top coins:\n${msg}`;
  }
  const data = await fetchJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(sym)}&vs_currencies=usd`);
  const key = Object.keys(data)[0];
  if (!key || !data[key]) throw new Error('Unknown symbol');
  return `${key}: $${data[key].usd}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crypto')
    .setDescription('Show cryptocurrency prices (via CoinGecko)')
    .addStringOption(o => o.setName('symbol').setDescription('e.g. bitcoin, ethereum or TOP').setRequired(false)),
  async execute(interaction) {
    const sym = (interaction.options.getString('symbol') || 'top').toLowerCase();
    try {
      const text = await priceText(sym);
      await interaction.client.sendWithLimits(interaction, text, { components: refreshRow(sym) });
    } catch (e) {
      await interaction.reply(`Error: ${e.message || 'failed to fetch'}`);
    }
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "crypto:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { payload: sym } = parseCustomId(interaction.customId);
    await interaction.deferUpdate();
    try {
      const text = await priceText(sym);
      await interaction.editReply({ content: text, components: refreshRow(sym) });
    } catch (e) {
      await interaction.editReply({ content: `Error: ${e.message || 'failed to fetch'}`, components: [] });
    }
  }
};
