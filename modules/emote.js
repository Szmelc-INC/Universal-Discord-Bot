const { SlashCommandBuilder } = require('discord.js');

async function fetchEmoji() {
  try {
    const res = await fetch('https://www.piliapp.com/emoticon/');
    const html = await res.text();
    const matches = [...html.matchAll(/<span class="symbol w4x" data-c="([^"]+)">/g)];
    if (!matches.length) return null;
    return matches[Math.floor(Math.random() * matches.length)][1];
  } catch (e) {
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('textemoji')
    .setDescription('Random text emoji'),
  async execute(interaction) {
    const emoji = await fetchEmoji();
    await interaction.reply(emoji || 'No emoji found.');
  }
};
