const { SlashCommandBuilder } = require('discord.js');

async function fetchJoke() {
  const page = Math.floor(Math.random() * (1768 - 2 + 1)) + 2;
  try {
    const res = await fetch(`https://www.sadistic.pl/dowcipy/${page}`);
    const html = await res.text();
    const matches = [...html.matchAll(/<div class="tresc">([\s\S]*?)<\/div>/g)];
    if (!matches.length) return null;
    const joke = matches[Math.floor(Math.random() * matches.length)][1]
      .replace(/<.*?>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return joke;
  } catch (e) {
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('joke')
    .setDescription('Get a random joke'),
  async execute(interaction) {
    const joke = await fetchJoke();
    await interaction.reply(joke || "Couldn't fetch a joke at the moment.");
  }
};
