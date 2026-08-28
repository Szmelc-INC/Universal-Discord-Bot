const { SlashCommandBuilder } = require('discord.js');
const { customId, parseCustomId, buttons } = require('../lib/interactions');

const MODULE = 'joke';
const rerollRow = type => buttons([{ id: customId(MODULE, 'reroll', type), label: 'Kolejny żart', style: 'secondary', emoji: '🔄' }]);

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
    await interaction.client.sendWithLimits(interaction, text, { components: rerollRow(type) });
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "joke:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { payload: type } = parseCustomId(interaction.customId);
    await interaction.deferUpdate();
    const text = type === 'pun' ? await getOfficialJoke() : await getDadJoke();
    await interaction.editReply({ content: text, components: rerollRow(type) });
  }
};
