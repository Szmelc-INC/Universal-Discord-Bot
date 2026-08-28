const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { customId, parseCustomId, reply, updatePanel, notice, buttons, selectMenu } = require('../lib/interactions');

const DOWNLOAD_DIR = path.join(__dirname, '..', '.downloads');
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.txt');
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB safety cap (Discord practical limit is much lower)
const DISCORD_UPLOAD_LIMIT = 25 * 1024 * 1024; // conservative 25MB
const SEARCH_CACHE_TTL = 10 * 60_000; // 10 min

// Cookie source, in priority order: yt-dlp's --cookies-from-browser reads a
// browser's live cookie store directly (no manual export needed), which is
// far less likely to go stale than a hand-exported cookies.txt. Firefox
// first since its cookie DB isn't locked by a running browser process the
// way Chromium-based ones are — https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp
const BROWSER_PRIORITY = ['firefox', 'chrome', 'chromium', 'brave', 'edge', 'vivaldi', 'opera'];

// Best-effort "is this browser installed on this host" check via its known
// profile/config directory — cheap (no process spawn) and good enough to
// pick a sane default. yt-dlp itself still does the real cookie extraction
// and reports its own error if the directory turns out to be empty/unusable.
function browserProfileDirs(browser) {
  const home = os.homedir();
  const plat = process.platform;
  const byPlatform = {
    firefox: {
      linux: [path.join(home, '.mozilla', 'firefox')],
      darwin: [path.join(home, 'Library', 'Application Support', 'Firefox')],
      win32: [path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox')]
    },
    chrome: {
      linux: [path.join(home, '.config', 'google-chrome')],
      darwin: [path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')],
      win32: [path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data')]
    },
    chromium: {
      linux: [path.join(home, '.config', 'chromium')],
      darwin: [path.join(home, 'Library', 'Application Support', 'Chromium')],
      win32: [path.join(process.env.LOCALAPPDATA || '', 'Chromium', 'User Data')]
    },
    brave: {
      linux: [path.join(home, '.config', 'BraveSoftware', 'Brave-Browser')],
      darwin: [path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')],
      win32: [path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data')]
    },
    edge: {
      linux: [path.join(home, '.config', 'microsoft-edge')],
      darwin: [path.join(home, 'Library', 'Application Support', 'Microsoft Edge')],
      win32: [path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data')]
    },
    vivaldi: {
      linux: [path.join(home, '.config', 'vivaldi')],
      darwin: [path.join(home, 'Library', 'Application Support', 'Vivaldi')],
      win32: [path.join(process.env.LOCALAPPDATA || '', 'Vivaldi', 'User Data')]
    },
    opera: {
      linux: [path.join(home, '.config', 'opera')],
      darwin: [path.join(home, 'Library', 'Application Support', 'com.operasoftware.Opera')],
      win32: [path.join(process.env.APPDATA || '', 'Opera Software', 'Opera Stable')]
    }
  };
  return byPlatform[browser]?.[plat] || [];
}

function isBrowserAvailable(browser) {
  return browserProfileDirs(browser).some(dir => {
    try { return fs.statSync(dir).isDirectory(); } catch { return false; }
  });
}

let cookieArgsCache = null;
// --cookies-from-browser <firefox, then any other detected browser> as the
// default, falling back to cookies.txt if present, else no cookie source at
// all. Cached after the first call — the host's installed-browser set
// doesn't change mid-process, and this only costs a handful of fs.stat calls
// either way.
function cookieArgs() {
  if (cookieArgsCache) return cookieArgsCache;

  for (const browser of BROWSER_PRIORITY) {
    if (isBrowserAvailable(browser)) {
      console.log(`[yt] Using cookies from browser: ${browser}`);
      return (cookieArgsCache = ['--cookies-from-browser', browser]);
    }
  }
  if (fs.existsSync(COOKIES_FILE)) {
    console.log('[yt] No browser cookie store found; using cookies.txt');
    return (cookieArgsCache = ['--cookies', COOKIES_FILE]);
  }
  console.log('[yt] No cookie source available (no supported browser profile, no cookies.txt) — some videos may fail to fetch');
  return (cookieArgsCache = []);
}

// messageId -> { userId, results: [{title,url}], chosen: number|null, expiresAt }
const searchCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of searchCache) if (entry.expiresAt < now) searchCache.delete(id);
}, 60_000).unref();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanup(file) {
  try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch {}
}

function hasYtDlp() {
  return new Promise(resolve => {
    execFile('yt-dlp', ['--version'], { timeout: 4000 }, (err) => resolve(!err));
  });
}

async function ytSearch(query, max = 5) {
  return new Promise((resolve) => {
    const args = [
      `ytsearch${max}:${query}`,
      '--flat-playlist',
      '--print', '%(title)s: %(webpage_url)s',
      '--no-warnings',
      '--skip-download'
    ];
    args.push(...cookieArgs());

    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', (code) => {
      if (code !== 0 && !out) {
        resolve({ error: err.trim() || 'Search failed' });
        return;
      }
      const lines = out.trim().split('\n').filter(Boolean).slice(0, max);
      const results = lines.map(line => {
        const m = line.match(/^(.*):\s*(https?:\/\/\S+)$/);
        return m ? { title: m[1].trim(), url: m[2].trim() } : { title: line, url: null };
      }).filter(r => r.url);
      resolve({ results });
    });
    setTimeout(() => { try { child.kill(); } catch {} }, 25000);
  });
}

async function downloadMedia(url, format /* 'mp3' | 'mp4' */) {
  ensureDir(DOWNLOAD_DIR);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const outTemplate = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);

  const args = ['--no-warnings', '--rm-cache-dir', '-o', outTemplate];
  args.push(...cookieArgs());

  if (format === 'mp3') {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '--recode-video', 'mp4');
  }
  args.push(url);

  return new Promise((resolve) => {
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => stderr += d);
    child.on('close', async (code) => {
      if (code !== 0) {
        return resolve({ error: 'yt-dlp failed: ' + stderr.split('\n').slice(-3).join(' ') });
      }

      // Find the actual file that was created
      const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.startsWith(id));
      if (!files.length) return resolve({ error: 'Downloaded file not found' });

      const filePath = path.join(DOWNLOAD_DIR, files[0]);
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_DOWNLOAD_BYTES) {
          cleanup(filePath);
          return resolve({ error: `File too large (${(stat.size / 1e9).toFixed(2)} GB)` });
        }
        resolve({ filePath, size: stat.size });
      } catch (e) {
        cleanup(filePath);
        resolve({ error: e.message });
      }
    });
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 180000); // 3 min max
  });
}

const MODULE = 'yt';

function resultsPayload(entry) {
  const { results, chosen } = entry;
  const lines = results.map((r, i) => `${i === chosen ? '**→**' : `${i + 1}.`} [${r.title}](${r.url})`);
  const rows = [selectMenu({
    id: customId(MODULE, 'pick'),
    placeholder: 'Wybierz film do pobrania…',
    options: results.map((r, i) => ({ label: r.title.slice(0, 100), value: String(i) }))
  })];
  if (chosen != null) {
    rows.push(...buttons([
      { id: customId(MODULE, 'dl', `mp3:${chosen}`), label: 'Pobierz MP3', style: 'success', emoji: '🎵' },
      { id: customId(MODULE, 'dl', `mp4:${chosen}`), label: 'Pobierz MP4', style: 'primary', emoji: '🎬' }
    ]));
  }
  return { content: lines.join('\n'), components: rows };
}

// Downloads `url` as `format` and edits `interaction` (already deferred/updated)
// in place: progress message first, then the finished file in the SAME message.
async function runDownload(interaction, url, format) {
  if (!await hasYtDlp()) {
    await reply(interaction, 'yt-dlp binary not found on host. Install it first.');
    return;
  }
  await reply(interaction, { content: `⏳ Pobieranie jako ${format.toUpperCase()}…`, components: [] });
  const dl = await downloadMedia(url, format);

  if (dl.error || !dl.filePath) {
    await reply(interaction, `❌ Pobieranie nieudane: ${dl.error || 'unknown'}`);
    return;
  }
  if (dl.size > DISCORD_UPLOAD_LIMIT) {
    await reply(interaction, `Pobrano (${(dl.size / 1024 / 1024).toFixed(1)} MB), ale plik przekracza limit uploadu Discorda. Zostawiony na hoście: ${dl.filePath}`);
    return;
  }
  try {
    await reply(interaction, {
      content: `✅ Gotowe — ${format.toUpperCase()}:`,
      files: [{ attachment: dl.filePath, name: path.basename(dl.filePath) }]
    });
  } catch (e) {
    await reply(interaction, `Błąd uploadu: ${e.message}. Plik pozostał na hoście: ${dl.filePath}`);
  } finally {
    setTimeout(() => cleanup(dl.filePath), 5 * 60 * 1000);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('yt')
    .setDescription('YouTube search and media download (yt-dlp)')
    .addSubcommand(sc => sc
      .setName('search')
      .setDescription('Search YouTube')
      .addStringOption(o => o.setName('query').setDescription('Search query').setRequired(true))
      .addIntegerOption(o => o.setName('max').setDescription('Max results (1-10)').setRequired(false)))
    .addSubcommand(sc => sc
      .setName('mp3')
      .setDescription('Download audio as MP3 (admin)')
      .addStringOption(o => o.setName('url').setDescription('YouTube or supported URL').setRequired(true)))
    .addSubcommand(sc => sc
      .setName('mp4')
      .setDescription('Download video as MP4 (admin)')
      .addStringOption(o => o.setName('url').setDescription('YouTube or supported URL').setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'search') {
      const query = interaction.options.getString('query');
      const max = Math.min(Math.max(interaction.options.getInteger('max') || 5, 1), 10);
      await interaction.deferReply();
      const result = await ytSearch(query, max);
      if (result.error) {
        await reply(interaction, `Search error: ${result.error}`);
        return;
      }
      if (!result.results.length) {
        await reply(interaction, 'No results.');
        return;
      }

      const entry = { userId: interaction.user.id, results: result.results, chosen: null, expiresAt: Date.now() + SEARCH_CACHE_TTL };
      const msg = await interaction.editReply(resultsPayload(entry));
      searchCache.set(msg.id, entry);
      return;
    }

    // mp3 / mp4 direct-URL subcommands are privileged
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Download commands are admin-only.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    await runDownload(interaction, interaction.options.getString('url'), sub);
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "yt:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { action, payload } = parseCustomId(interaction.customId);
    const entry = searchCache.get(interaction.message.id);

    if (!entry) {
      await updatePanel(interaction, { content: '⌛ Te wyniki wygasły — użyj `/yt search` ponownie.', components: [] });
      return;
    }
    if (interaction.user.id !== entry.userId) {
      await notice(interaction, 'Tylko autor wyszukiwania może tego użyć.');
      return;
    }

    if (action === 'pick') {
      entry.chosen = Number(interaction.values[0]);
      await updatePanel(interaction, resultsPayload(entry));
      return;
    }

    if (action === 'dl') {
      const [format, idxStr] = payload.split(':');
      const chosen = entry.results[Number(idxStr)];
      if (!chosen) {
        await notice(interaction, 'Nieprawidłowy wybór — wyszukaj ponownie.');
        return;
      }
      if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
        await notice(interaction, 'Pobieranie jest tylko dla adminów.');
        return;
      }
      await interaction.deferUpdate();
      searchCache.delete(interaction.message.id);
      await runDownload(interaction, chosen.url, format);
    }
  }
};
