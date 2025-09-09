const { SlashCommandBuilder } = require('discord.js');

async function fetchBoner() {
  try {
    const res = await fetch('https://egzorcysta.fandom.com/wiki/Bogdan_Boner');
    const html = await res.text();
    const matches = [...html.matchAll(/<li>(.*?)<\/li>/gs)];
    if (!matches.length) return 'No quotes found.';
    const cleaned = matches
      .map(m => m[1].replace(/<.*?>/g, '').split('(')[0].trim())
      .filter(Boolean);
    if (!cleaned.length) return 'No quotes found.';
    return cleaned[Math.floor(Math.random() * cleaned.length)];
  } catch (e) {
    return `Error: ${e}`;
  }
}

async function fetchBomba() {
  try {
    const res = await fetch('https://nonsa.pl/wiki/Cytaty:Kapitan_Bomba');
    const html = await res.text();
    const matches = [...html.matchAll(/<li>\s*<i>(.*?)<\/i>/gs)];
    if (!matches.length) return 'No quotes found.';
    const quote = matches[Math.floor(Math.random() * matches.length)][1]
      .replace(/<.*?>/g, '')
      .trim();
    return quote || 'No quote available.';
  } catch (e) {
    return `Error fetching quote: ${e}`;
  }
}

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
    .setName('quote')
    .setDescription('Random quotes, jokes or emojis')
    .addSubcommand(sc => sc.setName('boner').setDescription('Random Bogdan Boner quote'))
    .addSubcommand(sc => sc.setName('bomba').setDescription('Random Kapitan Bomba quote'))
    .addSubcommand(sc => sc.setName('joke').setDescription('Random joke'))
    .addSubcommand(sc => sc.setName('emoji').setDescription('Random text emoji')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    let response;
    if (sub === 'boner') response = await fetchBoner();
    else if (sub === 'bomba') response = await fetchBomba();
    else if (sub === 'joke') response = await fetchJoke();
    else if (sub === 'emoji') response = await fetchEmoji();
    else response = 'Unknown type.';
    await interaction.reply(response || 'No result.');
  }
};

