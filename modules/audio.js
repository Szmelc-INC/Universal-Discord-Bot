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
    .setName('audio')
    .setDescription('Audio related commands')
    .addSubcommand(sc =>
      sc
        .setName('youtube')
        .setDescription('Search YouTube')
        .addStringOption(o => o.setName('query').setDescription('Search query').setRequired(true))
        .addIntegerOption(o => o.setName('max').setDescription('Max results').setRequired(false))
    )
    .addSubcommand(sc =>
      sc
        .setName('music')
        .setDescription('Music playback is not implemented in the Node.js version')
    )
    .addSubcommand(sc =>
      sc
        .setName('dlp')
        .setDescription('Download media using yt-dlp (not implemented)')
        .addStringOption(o => o.setName('format').setDescription('mp3 or mp4').setRequired(true))
        .addStringOption(o => o.setName('url').setDescription('Media URL').setRequired(true))
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'youtube') {
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
    } else if (sub === 'music') {
      await interaction.reply('Music module is not available in this branch.');
    } else if (sub === 'dlp') {
      await interaction.reply('yt-dlp functionality is not available in the Node.js version yet.');
    } else {
      await interaction.reply('Unknown subcommand.');
    }
  }
};

