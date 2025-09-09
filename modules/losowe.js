const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

async function fetchMeme() {
  try {
    const res = await fetch('https://jbzd.com.pl/losowe');
    const html = await res.text();
    const pattern = /https:\/\/i1\.jbzd\.com\.pl\/contents\/\d{4}\/\d{2}\/[^"']+\.(jpg|gif|png|mp4)/;
    const match = html.match(pattern);
    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    return { url: match ? match[0] : null, title: titleMatch ? titleMatch[1] : 'Random Meme' };
  } catch (e) {
    return { url: null, title: 'Random Meme' };
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('losowe')
    .setDescription('Random meme from jbzd.com.pl'),
  async execute(interaction) {
    const { url, title } = await fetchMeme();
    if (!url) {
      await interaction.reply('Unable to find a meme.');
      return;
    }
    const embed = new EmbedBuilder().setTitle(title);
    if (url.endsWith('.mp4')) {
      embed.setDescription(url);
    } else {
      embed.setImage(url);
    }
    await interaction.reply({ embeds: [embed] });
  }
};
