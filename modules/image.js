const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { customId, parseCustomId, buttons } = require('../lib/interactions');

const MODULE = 'image';
const rerollRow = sub => buttons([{ id: customId(MODULE, 'reroll', sub), label: 'Losuj ponownie', style: 'secondary', emoji: '🔄' }]);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchWithUA(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' } });
}

async function fetchMeme() {
  // === Improved primary method: Reddit (more reliable than HTML scraping) ===
  const redditSubs = ['Polska_wpz', 'dankmemes', 'memes', 'Polska'];
  for (const sub of redditSubs) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/random.json`, {
        headers: { 'User-Agent': UA }
      });
      if (!res.ok) continue;
      const json = await res.json();
      const post = json?.[0]?.data?.children?.[0]?.data;
      if (post && (post.url?.endsWith('.jpg') || post.url?.endsWith('.png') || post.url?.endsWith('.gif') || post.url?.endsWith('.webp'))) {
        return {
          url: post.url,
          title: post.title || `r/${sub}`
        };
      }
    } catch (e) {}
  }

  // === Fallback 1: Original jbzd scraping (kept for resilience) ===
  try {
    const res = await fetchWithUA('https://jbzd.com.pl/losowe');
    const html = await res.text();
    let match = html.match(/https:\/\/i1\.jbzd\.com\.pl\/contents\/[^"'\s>]+?\.(jpg|jpeg|gif|png|mp4|webp)/i);
    if (!match) match = html.match(/https:\/\/[^"'\s>]+?jbzd[^"'\s>]+?\.(jpg|gif|png|mp4)/i);
    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
    if (match) {
      return { url: match[0], title: titleMatch ? titleMatch[1].trim() : 'Losowe z jbzd' };
    }
  } catch (e) {}

  // === Fallback 2: Public meme APIs ===
  try {
    const res = await fetch('https://meme-api.com/gimme/dankmemes');
    if (res.ok) {
      const data = await res.json();
      if (data?.url) return { url: data.url, title: data.title || 'Random Meme' };
    }
  } catch (e) {}

  try {
    const res = await fetch('https://meme-api.com/gimme/memes');
    if (res.ok) {
      const data = await res.json();
      if (data?.url) return { url: data.url, title: data.title || 'Random Meme' };
    }
  } catch (e) {}

  return { url: null, title: 'Meme' };
}

async function fetchCycki() {
  try {
    const res = await fetchWithUA('https://zmarsa.com/losowe');
    const html = await res.text();

    // Attempt 1: Standard storage image
    let m = html.match(/https:\/\/zmarsa\.com\/storage\/image\/[a-zA-Z0-9\/._-]+\.(jpg|jpeg|png|gif|webp)/i);
    if (m) return m[0];

    // Attempt 2: Any zmarsa storage image
    m = html.match(/https:\/\/zmarsa\.com\/storage\/[^"'\s>]+?\.(jpg|jpeg|png)/i);
    if (m) return m[0];

    // Attempt 3: og:image containing zmarsa
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (og && og[1].includes('zmarsa')) return og[1];

    // Attempt 4 (original loose fallback kept for maximum resilience)
    m = html.match(/https:\/\/zmarsa\.com\/storage\/image\/[^"'\s>]+/i);
    if (m) return m[0];
  } catch (e) {}
  return null;
}

async function losowePayload() {
  const { url, title } = await fetchMeme();
  if (!url) return { content: 'Unable to fetch a meme right now (sites may block or change).', embeds: [], components: [] };
  const embed = new EmbedBuilder().setTitle(title);
  if (/\.(mp4|webm)$/i.test(url)) embed.setDescription(`[Video/GIF](${url})`);
  else embed.setImage(url);
  return { content: '', embeds: [embed], components: rerollRow('losowe') };
}

async function cyckiPayload() {
  const url = await fetchCycki();
  if (!url) return { content: 'Unable to fetch image (site may have changed).', embeds: [], components: [] };
  const embed = new EmbedBuilder().setTitle('Losowe Witajki').setImage(url);
  return { content: '', embeds: [embed], components: rerollRow('cycki') };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('image')
    .setDescription('Random images / memes (losowe, cycki, etc)')
    .addSubcommand(sc => sc.setName('losowe').setDescription('Random meme (jbzd + fallbacks)'))
    .addSubcommand(sc => sc.setName('cycki').setDescription('Random image from zmarsa.com (NSFW)')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'losowe') {
      await interaction.reply(await losowePayload());
    } else if (sub === 'cycki') {
      await interaction.reply(await cyckiPayload());
    } else {
      await interaction.reply('Unknown subcommand.');
    }
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "image:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { payload } = parseCustomId(interaction.customId);
    await interaction.deferUpdate();
    await interaction.editReply(payload === 'cycki' ? await cyckiPayload() : await losowePayload());
  }
};

