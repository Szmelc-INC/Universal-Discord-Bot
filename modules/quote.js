const { SlashCommandBuilder } = require('discord.js');
const { customId, parseCustomId, buttons } = require('../lib/interactions');

const MODULE = 'quote';
const FETCHERS = { boner: fetchBoner, bomba: fetchBomba, joke: fetchJoke, emoji: fetchEmoji };
const rerollRow = sub => buttons([{ id: customId(MODULE, 'reroll', sub), label: 'Losuj ponownie', style: 'secondary', emoji: '🔄' }]);

// === BONER (improved selectors + static fallbacks) ===
const BONER_FALLBACKS = [
  "Ja nie piję, ja degustuję kulturę.",
  "Nie jestem alkoholikiem, jestem entuzjastą trunków.",
  "Wódka to nie problem, problem to brak wódki.",
];

async function fetchBoner() {
  // Try improved scraping
  try {
    const res = await fetch('https://egzorcysta.fandom.com/wiki/Bogdan_Boner', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();

    // More flexible patterns
    let matches = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/gs)];
    if (matches.length < 3) {
      matches = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gs)];
    }

    const cleaned = matches
      .map(m => m[1].replace(/<.*?>/g, '').split('(')[0].trim())
      .filter(t => t.length > 5 && t.length < 200);

    if (cleaned.length) {
      return cleaned[Math.floor(Math.random() * cleaned.length)];
    }
  } catch (e) {}

  // Static fallbacks (last resort)
  return BONER_FALLBACKS[Math.floor(Math.random() * BONER_FALLBACKS.length)];
}

// === BOMBA (improved + fallback) ===
const BOMBA_FALLBACKS = [
  "Kapitan Bomba to nie mit, to legenda!",
  "Ja nie piję, ja walczę z suszą!",
];

async function fetchBomba() {
  try {
    const res = await fetch('https://nonsa.pl/wiki/Cytaty:Kapitan_Bomba', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();

    let matches = [...html.matchAll(/<li>\s*<i>(.*?)<\/i>/gs)];
    if (!matches.length) {
      matches = [...html.matchAll(/<blockquote[^>]*>(.*?)<\/blockquote>/gs)];
    }

    if (matches.length) {
      const quote = matches[Math.floor(Math.random() * matches.length)][1]
        .replace(/<.*?>/g, '')
        .trim();
      if (quote) return quote;
    }
  } catch (e) {}

  return BOMBA_FALLBACKS[Math.floor(Math.random() * BOMBA_FALLBACKS.length)];
}

// === JOKE: Prefer public APIs first, then scraping fallback ===
async function fetchJoke() {
  // Primary: Public joke APIs (more reliable)
  try {
    const res = await fetch('https://official-joke-api.appspot.com/jokes/random');
    if (res.ok) {
      const j = await res.json();
      if (j?.setup && j?.punchline) {
        return `${j.setup} — ${j.punchline}`;
      }
    }
  } catch (e) {}

  try {
    const res = await fetch('https://icanhazdadjoke.com/', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Universal-Discord-Bot' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.joke) return data.joke;
    }
  } catch (e) {}

  // Fallback: Original sadistic.pl scraping (kept for resilience)
  try {
    const page = Math.floor(Math.random() * (1768 - 2 + 1)) + 2;
    const res = await fetch(`https://www.sadistic.pl/dowcipy/${page}`);
    const html = await res.text();
    const matches = [...html.matchAll(/<div class="tresc">([\s\S]*?)<\/div>/g)];
    if (matches.length) {
      const joke = matches[Math.floor(Math.random() * matches.length)][1]
        .replace(/<.*?>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (joke) return joke;
    }
  } catch (e) {}

  return null;
}

// === EMOJI: Static list first (fast + reliable), scraping as fallback ===
const STATIC_EMOJIS = [
  '( ͡° ͜ʖ ͡°)', '¯\\_(ツ)_/¯', '(╯°□°)╯︵ ┻━┻', 'ಠ_ಠ', '( ͡◉ ͜ʖ ͡◉)',
  'ヽ( ͡° ͜ʖ ͡°)ﾉ', '(ノಠ益ಠ)ノ彡┻━┻', 'ʕ•ᴥ•ʔ', '(ง ͠° ͟ل͜ ͡°)ง', 'ლ(ಠ益ಠლ)',
];

async function fetchEmoji() {
  // Primary: Static reliable list
  if (Math.random() < 0.7) { // 70% chance to use static for speed
    return STATIC_EMOJIS[Math.floor(Math.random() * STATIC_EMOJIS.length)];
  }

  // Fallback: Original scraping
  try {
    const res = await fetch('https://www.piliapp.com/emoticon/', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();
    const matches = [...html.matchAll(/<span class="symbol w4x" data-c="([^"]+)">/g)];
    if (matches.length) {
      return matches[Math.floor(Math.random() * matches.length)][1];
    }
  } catch (e) {}

  // Last resort static
  return STATIC_EMOJIS[Math.floor(Math.random() * STATIC_EMOJIS.length)];
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
    const fetcher = FETCHERS[sub];
    const response = fetcher ? await fetcher() : null;
    await interaction.reply({ content: response || 'No result.', components: fetcher ? rerollRow(sub) : [] });
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "quote:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { payload: sub } = parseCustomId(interaction.customId);
    const fetcher = FETCHERS[sub];
    if (!fetcher) return;
    await interaction.deferUpdate();
    const response = await fetcher();
    await interaction.editReply({ content: response || 'No result.', components: rerollRow(sub) });
  }
};

