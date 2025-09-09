const { SlashCommandBuilder } = require('discord.js');

const API_KEYS = ['xyz', 'xyz', 'xyz'];
let currentKey = 0;

function getKey() {
  const key = API_KEYS[currentKey];
  currentKey = (currentKey + 1) % API_KEYS.length;
  return key;
}

async function search(query, maxResults) {
  const apiKey = getKey();
  const q = encodeURIComponent(query);
  const url = `https://www.googleapis.com/youtube/v3/search?q=${q}&part=snippet&type=video&maxResults=${maxResults}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.items) return [];
  return data.items.map(item => {
    const id = item.id.videoId;
    const title = item.snippet.title;
    return `${title}: https://www.youtube.com/watch?v=${id}`;
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Search YouTube')
    .addStringOption(o => o.setName('query').setDescription('Search query').setRequired(true))
    .addIntegerOption(o => o.setName('max').setDescription('Max results').setRequired(false)),
  async execute(interaction) {
    const query = interaction.options.getString('query');
    const max = interaction.options.getInteger('max') || 1;
    try {
      const results = await search(query, max);
      if (!results.length) {
        await interaction.reply('No search results found.');
        return;
      }
      await interaction.reply(results.join('\n'));
    } catch (e) {
      await interaction.reply(`An error occurred: ${e.message}`);
    }
  }
};
