const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

async function fetchImage() {
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
    .setName('cycki')
    .setDescription('Random image from zmarsa.com'),
  async execute(interaction) {
    const url = await fetchImage();
    if (!url) {
      await interaction.reply('Unable to find an image.');
      return;
    }
    const embed = new EmbedBuilder().setTitle('Losowe Witajki').setImage(url);
    await interaction.reply({ embeds: [embed] });
  }
};
