const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DOWNLOAD_DIR = path.join(__dirname, '..', '.downloads');
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.txt');
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB safety cap (Discord practical limit is much lower)
const DISCORD_UPLOAD_LIMIT = 25 * 1024 * 1024; // conservative 25MB

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
    if (fs.existsSync(COOKIES_FILE)) args.push('--cookies', COOKIES_FILE);

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
      resolve({ results: lines });
    });
    setTimeout(() => { try { child.kill(); } catch {} }, 25000);
  });
}

async function downloadMedia(url, format /* 'mp3' | 'mp4' */) {
  ensureDir(DOWNLOAD_DIR);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const outTemplate = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);

  const args = ['--no-warnings', '--rm-cache-dir', '-o', outTemplate];
  if (fs.existsSync(COOKIES_FILE)) args.push('--cookies', COOKIES_FILE);

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
        await interaction.editReply(`Search error: ${result.error}`);
        return;
      }
      if (!result.results || !result.results.length) {
        await interaction.editReply('No results.');
        return;
      }
      await interaction.client.sendWithLimits(interaction, result.results.join('\n'));
      return;
    }

    // mp3 / mp4 are privileged
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Download commands are admin-only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const url = interaction.options.getString('url');
    const format = sub;

    if (!await hasYtDlp()) {
      await interaction.reply({ content: 'yt-dlp binary not found on host. Install it first (same as Python version).', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const dl = await downloadMedia(url, format);

    if (dl.error || !dl.filePath) {
      await interaction.editReply(`Download failed: ${dl.error || 'unknown'}`);
      return;
    }

    if (dl.size > DISCORD_UPLOAD_LIMIT) {
      await interaction.editReply(`Downloaded (${(dl.size / 1024 / 1024).toFixed(1)} MB) but exceeds typical Discord upload limit. File left on host at: ${dl.filePath}`);
      return;
    }

    try {
      await interaction.editReply({ content: `Downloaded as ${format.toUpperCase()} — uploading...` });
      await interaction.followUp({
        content: `${format.toUpperCase()} ready:`,
        files: [{ attachment: dl.filePath, name: path.basename(dl.filePath) }]
      });
    } catch (e) {
      await interaction.followUp(`Upload error: ${e.message}. File remains on disk: ${dl.filePath}`);
    } finally {
      // We intentionally leave the file for a bit in case followUp fails; a real impl would use a cleanup job
      setTimeout(() => cleanup(dl.filePath), 5 * 60 * 1000);
    }
  }
};
