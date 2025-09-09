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

async function fetchCycki() {
  try {
    const res = await fetch('https://zmarsa.com/losowe');
    const html = await res.text();
    const match = html.match(/<img[^>]*class="post-image"[^>]*src="(https:\/\/zmarsa\.com\/storage\/image\/[^"']+)"/i);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('image')
    .setDescription('Random images')
    .addSubcommand(sc => sc.setName('losowe').setDescription('Random meme from jbzd.com.pl'))
    .addSubcommand(sc => sc.setName('cycki').setDescription('Random image from zmarsa.com')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'losowe') {
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
    } else if (sub === 'cycki') {
      const url = await fetchCycki();
      if (!url) {
        await interaction.reply('Unable to find an image.');
        return;
      }
      const embed = new EmbedBuilder().setTitle('Losowe Witajki').setImage(url);
      await interaction.reply({ embeds: [embed] });
    } else {
      await interaction.reply('Unknown subcommand.');
    }
  }
};

