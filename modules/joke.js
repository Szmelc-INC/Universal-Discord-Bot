const { SlashCommandBuilder } = require('discord.js');

async function getDadJoke() {
  try {
    const res = await fetch('https://icanhazdadjoke.com/', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Universal-Discord-Bot (https://github.com)' }
    });
    if (!res.ok) throw new Error('API fail');
    const data = await res.json();
    return data.joke || 'No joke today.';
  } catch {
    return 'Joke API unavailable.';
  }
}

async function getOfficialJoke() {
  try {
    const res = await fetch('https://official-joke-api.appspot.com/jokes/random');
    if (!res.ok) throw new Error('API fail');
    const j = await res.json();
    return `${j.setup} — ${j.punchline}`;
  } catch {
    return 'Joke API unavailable.';
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('joke')
    .setDescription('Random dad joke or pun')
    .addStringOption(o => o.setName('type')
      .setDescription('joke type')
      .addChoices(
        { name: 'dad', value: 'dad' },
        { name: 'pun', value: 'pun' }
      )),
  async execute(interaction) {
    const type = interaction.options.getString('type') || 'dad';
    const text = type === 'pun' ? await getOfficialJoke() : await getDadJoke();
    await interaction.client.sendWithLimits(interaction, text);
  }
};
