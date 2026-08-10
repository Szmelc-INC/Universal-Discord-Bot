const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');

const EXPORT_BASE = path.join(__dirname, '..', 'exports');
const DISCORD_EPOCH = 1420070400000n;
const UPLOAD_ENDPOINT = 'https://bashupload.app/';
const USER_AGENT = 'UniversalDiscordBot/3.0 (+export module)';

const DEFAULTS = {
  // Discord's default per-file ceiling. Archives at or below this are DM'd
  // directly and never touch a third-party host.
  directAttachmentMaxBytes: 10 * 1024 * 1024,
  maxMessages: 50000,
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxMediaTotalBytes: 512 * 1024 * 1024,
  fetchDelayMs: 250,
  progressIntervalMs: 5000,
  uploadTimeoutMs: 30 * 60 * 1000
};

// One in-flight job per guild. Reset on /modules reload (the map lives in module scope).
const jobs = new Map();

function cfg(client) {
  return { ...DEFAULTS, ...(client?.config?.export || {}) };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeName(str, fallback = 'unnamed') {
  const cleaned = String(str || '').replace(/[^a-z0-9_.-]/gi, '_').replace(/_{2,}/g, '_').slice(0, 60);
  return cleaned.replace(/^[._]+|[._]+$/g, '') || fallback;
}

function humanBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ------------------------------------------------------------------ *
 * Timeframe handling
 * ------------------------------------------------------------------ */

const DURATION_UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };

function parseDuration(str) {
  const m = String(str).trim().match(/^(\d+)\s*([smhdw])$/i);
  if (!m) return null;
  return parseInt(m[1], 10) * DURATION_UNITS[m[2].toLowerCase()];
}

// Accepts: "2h" / "7d" (that much time ago), ISO dates, "now", "beginning"/"all"/"0".
function resolveInstant(str) {
  const raw = String(str || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (['beginning', 'all', 'start', '0'].includes(lower)) return 0;
  if (lower === 'now') return Date.now();
  const dur = parseDuration(raw);
  if (dur !== null) return Date.now() - dur;
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return parsed;
  return undefined; // undefined = unparseable, null = not provided
}

// Discord snowflakes embed the timestamp, so a synthetic id lets the API skip
// straight to the right slice of history instead of walking the whole channel.
function timestampToSnowflake(ms) {
  const clamped = Math.max(0, Math.floor(ms));
  return ((BigInt(clamped) - DISCORD_EPOCH) << 22n).toString();
}

/* ------------------------------------------------------------------ *
 * HTTP helpers (Discord CDN redirects, bashupload PUT)
 * ------------------------------------------------------------------ */

const REDIRECTS = [301, 302, 303, 307, 308];

function downloadTo(url, dest, maxBytes, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    const mod = url.startsWith('http://') ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      const code = res.statusCode || 0;
      if (REDIRECTS.includes(code) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(downloadTo(next, dest, maxBytes, depth + 1));
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${code}`));
      }
      const declared = parseInt(res.headers['content-length'] || '0', 10);
      if (maxBytes && declared > maxBytes) {
        res.resume();
        return reject(new Error('exceeds per-file limit'));
      }
      const file = fs.createWriteStream(dest);
      let written = 0;
      let aborted = false;
      res.on('data', (chunk) => {
        written += chunk.length;
        if (maxBytes && written > maxBytes && !aborted) {
          aborted = true;
          res.destroy();
          file.destroy();
          try { fs.unlinkSync(dest); } catch {}
          reject(new Error('exceeds per-file limit'));
        }
      });
      res.pipe(file);
      file.on('finish', () => { if (!aborted) file.close(() => resolve(written)); });
      file.on('error', (e) => {
        try { fs.unlinkSync(dest); } catch {}
        if (!aborted) reject(e);
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('download timeout')));
  });
}

function putFile(urlStr, filePath, timeoutMs, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const size = fs.statSync(filePath).size;
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'PUT',
      headers: {
        'Content-Length': size,
        'Content-Type': 'application/zip',
        'User-Agent': USER_AGENT
      }
    }, (res) => {
      const code = res.statusCode || 0;
      if (REDIRECTS.includes(code) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, urlStr).toString();
        return resolve(putFile(next, filePath, timeoutMs, depth + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (code >= 200 && code < 300) resolve(body);
        else reject(new Error(`HTTP ${code}: ${body.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('upload timeout')));
    fs.createReadStream(filePath).pipe(req);
  });
}

function runCurl(filePath, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      // Without an explicit Content-Type bashupload stores the archive as
      // <random>.bin instead of <random>.zip.
      ['-sS', '-L', '--max-time', String(Math.floor(timeoutMs / 1000)),
        '-H', 'Content-Type: application/zip', UPLOAD_ENDPOINT, '-T', filePath],
      { timeout: timeoutMs + 30000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr?.trim() || err.message));
        resolve(stdout);
      }
    );
  });
}

// bashupload answers with a wget line containing the single-use download URL.
// No URL in the body means the upload did not succeed, whatever the status code said.
function extractLink(body) {
  const found = String(body).match(/https?:\/\/[^\s"'<>]+/g) || [];
  const cleaned = found.map(s => s.replace(/[.,;)\]]+$/, ''));
  const withPath = cleaned.filter(s => {
    try { return new URL(s).pathname.replace(/\/+$/, '').length > 1; } catch { return false; }
  });
  return withPath.find(s => /bashupload/i.test(s)) || withPath[0] || null;
}

async function uploadArchive(filePath, timeoutMs) {
  // curl is what the workflow is specified around; the native PUT is the same
  // request for hosts without curl (the node:22-alpine image has neither curl nor zip).
  let body;
  let via = 'curl';
  try {
    body = await runCurl(filePath, timeoutMs);
  } catch (curlError) {
    via = 'node-https';
    const target = UPLOAD_ENDPOINT + encodeURIComponent(path.basename(filePath));
    body = await putFile(target, filePath, timeoutMs);
  }
  const raw = String(body).trim();
  // Only used to tell a successful upload from an error page — the DM shows the
  // service's own response verbatim, so nothing here can mangle the real link.
  const link = extractLink(raw);
  if (!link) {
    throw new Error(`upload response contained no download URL (via ${via}): ${raw.slice(0, 300)}`);
  }
  return { link, via, raw };
}

/* ------------------------------------------------------------------ *
 * Minimal ZIP writer (deflate/store, no zip64) — avoids depending on a
 * `zip` binary, which is absent from the Docker image.
 * ------------------------------------------------------------------ */

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(buf) {
  const t = crcTable();
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ t[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31);
  const date = (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

// Media is already compressed; re-deflating it burns CPU for nothing.
const STORE_EXTENSIONS = new Set([
  '.zip', '.gz', '.xz', '.7z', '.rar', '.bz2',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.mp4', '.webm', '.mkv', '.mov', '.mp3', '.ogg', '.opus', '.flac', '.m4a'
]);

function walkFiles(rootDir, current = rootDir, out = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(current, entry.name);
    if (entry.isDirectory()) walkFiles(rootDir, abs, out);
    else if (entry.isFile()) out.push(path.relative(rootDir, abs));
  }
  return out;
}

// Deflating anything bigger than this pins the event loop for too long to be
// worth the ratio; store it instead.
const MAX_DEFLATE_BYTES = 32 * 1024 * 1024;

// Async purely so the loop can breathe between entries — a global export with
// media can push hundreds of MB through here, and a blocked loop means missed
// gateway heartbeats and a reconnect mid-export.
async function createZip(rootDir, outPath, onProgress = async () => {}) {
  const entries = walkFiles(rootDir);
  if (!entries.length) throw new Error('nothing to archive');
  if (entries.length > 65534) throw new Error(`too many files for a non-zip64 archive (${entries.length})`);

  const fd = fs.openSync(outPath, 'w');
  const central = [];
  let offset = 0;
  const write = (buf) => { fs.writeSync(fd, buf); offset += buf.length; };

  try {
    let done = 0;
    for (const rel of entries) {
      await new Promise(r => setImmediate(r));
      await onProgress(++done, entries.length);
      const abs = path.join(rootDir, rel);
      const stat = fs.statSync(abs);
      const data = fs.readFileSync(abs);
      const crc = crc32(data);
      const ext = path.extname(rel).toLowerCase();

      let method = 0;
      let payload = data;
      if (data.length && data.length <= MAX_DEFLATE_BYTES && !STORE_EXTENSIONS.has(ext)) {
        const deflated = zlib.deflateRawSync(data, { level: 6 });
        if (deflated.length < data.length) {
          method = 8;
          payload = deflated;
        }
      }

      const nameBuf = Buffer.from(rel.split(path.sep).join('/'), 'utf8');
      const { time, date } = dosDateTime(stat.mtime);
      const localOffset = offset;

      const lfh = Buffer.alloc(30);
      lfh.writeUInt32LE(0x04034b50, 0);
      lfh.writeUInt16LE(20, 4);       // version needed
      lfh.writeUInt16LE(0x0800, 6);   // UTF-8 filename flag
      lfh.writeUInt16LE(method, 8);
      lfh.writeUInt16LE(time, 10);
      lfh.writeUInt16LE(date, 12);
      lfh.writeUInt32LE(crc, 14);
      lfh.writeUInt32LE(payload.length, 18);
      lfh.writeUInt32LE(data.length, 22);
      lfh.writeUInt16LE(nameBuf.length, 26);
      lfh.writeUInt16LE(0, 28);
      write(lfh);
      write(nameBuf);
      write(payload);

      const cdh = Buffer.alloc(46);
      cdh.writeUInt32LE(0x02014b50, 0);
      cdh.writeUInt16LE(20, 4);       // version made by
      cdh.writeUInt16LE(20, 6);       // version needed
      cdh.writeUInt16LE(0x0800, 8);
      cdh.writeUInt16LE(method, 10);
      cdh.writeUInt16LE(time, 12);
      cdh.writeUInt16LE(date, 14);
      cdh.writeUInt32LE(crc, 16);
      cdh.writeUInt32LE(payload.length, 20);
      cdh.writeUInt32LE(data.length, 24);
      cdh.writeUInt16LE(nameBuf.length, 28);
      cdh.writeUInt16LE(0, 30);       // extra len
      cdh.writeUInt16LE(0, 32);       // comment len
      cdh.writeUInt16LE(0, 34);       // disk start
      cdh.writeUInt16LE(0, 36);       // internal attrs
      cdh.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      cdh.writeUInt32LE(localOffset, 42);
      central.push(Buffer.concat([cdh, nameBuf]));
    }

    const cdStart = offset;
    for (const buf of central) write(buf);
    const cdSize = offset - cdStart;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    write(eocd);
  } finally {
    fs.closeSync(fd);
  }

  return { files: entries.length, size: fs.statSync(outPath).size };
}

/* ------------------------------------------------------------------ *
 * Scraping
 * ------------------------------------------------------------------ */

function serializeMessage(msg) {
  return {
    id: msg.id,
    type: msg.type,
    timestamp: new Date(msg.createdTimestamp).toISOString(),
    editedTimestamp: msg.editedTimestamp ? new Date(msg.editedTimestamp).toISOString() : null,
    pinned: msg.pinned,
    author: {
      id: msg.author?.id || null,
      tag: msg.author?.tag || null,
      displayName: msg.member?.displayName || msg.author?.globalName || null,
      bot: Boolean(msg.author?.bot)
    },
    content: msg.content || '',
    replyTo: msg.reference?.messageId || null,
    attachments: [...msg.attachments.values()].map(a => ({
      id: a.id,
      name: a.name,
      size: a.size,
      contentType: a.contentType || null,
      url: a.url,
      savedAs: null
    })),
    embeds: msg.embeds.map(e => ({
      type: e.data?.type || null,
      title: e.title || null,
      description: e.description || null,
      url: e.url || null
    })),
    stickers: [...msg.stickers.values()].map(s => ({ id: s.id, name: s.name })),
    reactions: [...msg.reactions.cache.values()].map(r => ({
      emoji: r.emoji?.name || null,
      emojiId: r.emoji?.id || null,
      count: r.count
    }))
  };
}

function renderText(channelLabel, messages) {
  const lines = [`# ${channelLabel}`, `# ${messages.length} message(s), oldest first`, ''];
  for (const m of messages) {
    lines.push(`[${m.timestamp}] ${m.author.tag || 'unknown'} (${m.author.id || '?'}): ${m.content}`);
    for (const a of m.attachments) {
      lines.push(`    [attachment] ${a.name} (${humanBytes(a.size)})${a.savedAs ? ` -> ${a.savedAs}` : ''} ${a.url}`);
    }
    for (const e of m.embeds) {
      if (e.title || e.description) lines.push(`    [embed] ${e.title || ''} ${e.description ? `- ${String(e.description).slice(0, 200)}` : ''}`.trim());
    }
    if (m.reactions.length) {
      lines.push(`    [reactions] ${m.reactions.map(r => `${r.emoji}x${r.count}`).join(' ')}`);
    }
  }
  return lines.join('\n');
}

async function scrapeChannel(channel, job, limits, onProgress = async () => {}) {
  const collected = [];
  // Start the cursor just past the end of the window instead of at "newest".
  let before = job.toTs < Date.now() ? timestampToSnowflake(job.toTs + 1) : null;

  while (true) {
    if (job.cancelled) break;
    if (job.totalMessages + collected.length >= job.limit) { job.hitLimit = true; break; }

    const opts = { limit: 100 };
    if (before) opts.before = before;

    let batch;
    try {
      batch = await channel.messages.fetch(opts);
    } catch (e) {
      job.errors.push(`${channel.name || channel.id}: fetch failed (${e.message})`);
      break;
    }
    if (!batch.size) break;

    let oldestInBatch = Infinity;
    for (const msg of batch.values()) {
      oldestInBatch = Math.min(oldestInBatch, msg.createdTimestamp);
      if (msg.createdTimestamp < job.fromTs || msg.createdTimestamp > job.toTs) continue;
      if (job.userId && msg.author?.id !== job.userId) continue;
      collected.push(serializeMessage(msg));
      if (job.totalMessages + collected.length >= job.limit) { job.hitLimit = true; break; }
    }

    before = batch.lastKey();
    job.scanned += batch.size;
    job.channelMessages = collected.length;
    // Reported every page, not just once per channel, so a long single-channel
    // scrape still visibly moves.
    await onProgress();

    if (batch.size < 100) break;
    if (oldestInBatch < job.fromTs) break; // walked past the start of the window
    if (limits.fetchDelayMs) await new Promise(r => setTimeout(r, limits.fetchDelayMs));
  }

  collected.reverse(); // oldest first
  return collected;
}

async function downloadMedia(messages, channel, job, mediaRoot, limits, onProgress = async () => {}) {
  const dir = path.join(mediaRoot, `${safeName(channel.name, 'channel')}-${channel.id}`);
  const pending = messages.reduce((n, m) => n + m.attachments.length, 0);
  job.mediaPending = pending;
  let saved = 0;
  for (const m of messages) {
    if (job.cancelled) break;
    for (const att of m.attachments) {
      if (job.mediaBytes >= limits.maxMediaTotalBytes) {
        job.mediaBudgetHit = true;
        return saved;
      }
      if (att.size && att.size > limits.maxAttachmentBytes) {
        job.mediaSkipped++;
        continue;
      }
      ensureDir(dir);
      const ext = path.extname(att.name || '') || '.bin';
      const fileName = safeName(`${m.id}_${att.id}_${path.basename(att.name || 'file', ext)}`, `${m.id}_${att.id}`) + ext.toLowerCase();
      const dest = path.join(dir, fileName);
      try {
        const bytes = await downloadTo(att.url, dest, limits.maxAttachmentBytes);
        att.savedAs = path.posix.join('media', path.basename(dir), fileName);
        job.mediaBytes += bytes;
        job.mediaFiles++;
        saved++;
      } catch (e) {
        job.mediaSkipped++;
        job.errors.push(`attachment ${att.name} (${m.id}): ${e.message}`);
      }
      await onProgress();
    }
  }
  return saved;
}

/* ------------------------------------------------------------------ *
 * Cleanup
 * ------------------------------------------------------------------ */

function removeInsideExportBase(target) {
  const base = path.resolve(EXPORT_BASE);
  const resolved = path.resolve(target);
  if (resolved === base || !resolved.startsWith(base + path.sep)) {
    throw new Error(`refusing to delete outside the export directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ *
 * Command
 * ------------------------------------------------------------------ */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('export')
    .setDescription('Scrape and export messages, then upload the archive and DM a single-use link (Admin only)')
    // Visibility hint only — Discord hides the command below this permission,
    // which would lock out `config.adminRoles` members who lack Administrator.
    // The real authorization is the `client.isAdmin` check in execute().
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc => sc
      .setName('run')
      .setDescription('Run an export with a custom configuration')
      .addStringOption(o => o
        .setName('scope')
        .setDescription('Which channels to scrape (default: the current channel)')
        .addChoices(
          { name: 'channel — one channel', value: 'channel' },
          { name: 'global — every readable channel in this server', value: 'global' }
        ))
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('Channel to export (scope=channel only; defaults to the current one)'))
      .addUserOption(o => o
        .setName('user')
        .setDescription('Only export messages from this user (default: all users)'))
      .addBooleanOption(o => o
        .setName('media')
        .setDescription('Download attachments into the archive (default: false)'))
      .addStringOption(o => o
        .setName('since')
        .setDescription('Timeframe start: 24h, 7d, 30m, an ISO date, or "beginning" (default: beginning)'))
      .addStringOption(o => o
        .setName('from')
        .setDescription('Explicit window start (ISO date or relative like 7d) — overrides "since"'))
      .addStringOption(o => o
        .setName('to')
        .setDescription('Explicit window end (ISO date or relative like 2h; default: now)'))
      .addStringOption(o => o
        .setName('format')
        .setDescription('Output files per channel (default: both)')
        .addChoices(
          { name: 'both — JSON + TXT', value: 'both' },
          { name: 'json', value: 'json' },
          { name: 'txt', value: 'txt' }
        ))
      .addBooleanOption(o => o
        .setName('threads')
        .setDescription('Also scrape active threads (default: false)'))
      .addIntegerOption(o => o
        .setName('limit')
        .setDescription('Safety cap on total messages (default: 50000)')
        .setMinValue(1)
        .setMaxValue(500000)))
    .addSubcommand(sc => sc
      .setName('status')
      .setDescription('Show the export currently running in this server'))
    .addSubcommand(sc => sc
      .setName('cancel')
      .setDescription('Cancel the export currently running in this server')),

  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Unauthorized — this command is admin only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const job = jobs.get(guild.id);
      if (!job) {
        await interaction.reply({ content: 'No export is running in this server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const mins = ((Date.now() - job.startedAt) / 60000).toFixed(1);
      await interaction.reply({
        content: [
          `**Export running** (${mins} min)`,
          `Started by: <@${job.requesterId}>`,
          `Stage: ${job.stage}`,
          `Channels: ${job.channelsDone}/${job.channelsTotal} · messages: ${job.totalMessages}`,
          `Media: ${job.mediaFiles} file(s), ${humanBytes(job.mediaBytes)}`,
          job.cancelled ? 'Cancellation requested — finishing current step.' : ''
        ].filter(Boolean).join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (sub === 'cancel') {
      const job = jobs.get(guild.id);
      if (!job) {
        await interaction.reply({ content: 'No export is running in this server.', flags: MessageFlags.Ephemeral });
        return;
      }
      job.cancelled = true;
      await interaction.reply({ content: 'Cancellation requested — the export will stop after the current step and clean up.', flags: MessageFlags.Ephemeral });
      return;
    }

    // ---------------- run ----------------
    if (jobs.has(guild.id)) {
      await interaction.reply({ content: 'An export is already running in this server. Use `/export status` or `/export cancel`.', flags: MessageFlags.Ephemeral });
      return;
    }

    const limits = cfg(interaction.client);
    const scope = interaction.options.getString('scope') || 'channel';
    const chosenChannel = interaction.options.getChannel('channel');
    const targetUser = interaction.options.getUser('user');
    const withMedia = interaction.options.getBoolean('media') || false;
    const includeThreads = interaction.options.getBoolean('threads') || false;
    const format = interaction.options.getString('format') || 'both';
    const maxMessages = interaction.options.getInteger('limit') || limits.maxMessages;

    // Timeframe: from/to win, then since, then "since beginning".
    const sinceRaw = interaction.options.getString('since');
    const fromRaw = interaction.options.getString('from');
    const toRaw = interaction.options.getString('to');

    const fromResolved = resolveInstant(fromRaw ?? sinceRaw);
    const toResolved = resolveInstant(toRaw);
    if (fromResolved === undefined) {
      await interaction.reply({ content: `Could not parse the start of the window: \`${fromRaw ?? sinceRaw}\`. Use \`24h\`, \`7d\`, an ISO date like \`2026-08-01\`, or \`beginning\`.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (toResolved === undefined) {
      await interaction.reply({ content: `Could not parse the end of the window: \`${toRaw}\`. Use \`2h\`, an ISO date, or \`now\`.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const fromTs = fromResolved === null ? 0 : fromResolved;
    const toTs = toResolved === null ? Date.now() : toResolved;
    if (fromTs >= toTs) {
      await interaction.reply({ content: 'The start of the window must be earlier than its end.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Resolve the channel set. Export only needs to *read*, so ViewChannel +
    // ReadMessageHistory is the correct gate (not ManageMessages).
    const me = guild.members.me;
    const readable = (ch) => {
      const perms = ch.permissionsFor(me);
      return Boolean(perms && perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.ReadMessageHistory));
    };
    const TEXTLIKE = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice];
    // Forums hold no messages themselves — their posts are threads, so they only
    // matter as thread parents.
    const THREAD_ONLY_PARENTS = [ChannelType.GuildForum, ChannelType.GuildMedia];

    let channels = [];
    let threadParents = [];
    const preErrors = []; // collected before the job object exists
    try {
      if (scope === 'global') {
        const all = await guild.channels.fetch();
        const visible = [...all.values()].filter(c => c && readable(c));
        channels = visible.filter(c => TEXTLIKE.includes(c.type));
        threadParents = visible.filter(c => THREAD_ONLY_PARENTS.includes(c.type));
      } else {
        const ch = chosenChannel ? await guild.channels.fetch(chosenChannel.id).catch(() => null) : interaction.channel;
        if (!ch) {
          await interaction.editReply('That channel could not be resolved.').catch(() => {});
          return;
        }
        if (!readable(ch)) {
          await interaction.editReply(`Missing **View Channel** / **Read Message History** in ${ch}.`).catch(() => {});
          return;
        }
        if (THREAD_ONLY_PARENTS.includes(ch.type)) {
          if (!includeThreads) {
            await interaction.editReply(`${ch} is a forum — its messages live in posts. Re-run with \`threads: true\` to export them.`).catch(() => {});
            return;
          }
          threadParents = [ch];
        } else if (typeof ch.messages?.fetch !== 'function') {
          await interaction.editReply('That channel has no message history to export.').catch(() => {});
          return;
        } else {
          channels = [ch];
        }
      }

      if (includeThreads) {
        for (const parent of [...channels, ...threadParents]) {
          if (typeof parent.threads?.fetchActive !== 'function') continue;
          try {
            const active = await parent.threads.fetchActive();
            for (const th of active.threads.values()) {
              if (readable(th)) channels.push(th);
            }
          } catch (e) {
            preErrors.push(`${parent.name}: thread listing failed (${e.message})`);
          }
        }
      }
    } catch (e) {
      await interaction.editReply(`Could not resolve channels: ${e.message}`).catch(() => {});
      return;
    }

    if (!channels.length) {
      await interaction.editReply('No readable channels matched this configuration.').catch(() => {});
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const workDir = path.join(EXPORT_BASE, `export-${stamp}`);
    const zipPath = path.join(EXPORT_BASE, `export-${stamp}.zip`);

    const job = {
      requesterId: interaction.user.id,
      startedAt: Date.now(),
      stage: 'scraping',
      cancelled: false,
      fromTs,
      toTs,
      userId: targetUser?.id || null,
      limit: maxMessages,
      channelsTotal: channels.length,
      channelsDone: 0,
      totalMessages: 0,
      scanned: 0,
      mediaFiles: 0,
      mediaBytes: 0,
      mediaSkipped: 0,
      mediaBudgetHit: false,
      hitLimit: false,
      errors: preErrors
    };
    jobs.set(guild.id, job);

    // Rendered from live job state so any caller gets the current picture without
    // having to compose a message. The interaction token dies after 15 minutes, so
    // every edit is best-effort and the DM stays the real delivery path.
    const STAGE_LABEL = {
      scraping: 'Scraping messages',
      media: 'Downloading media',
      writing: 'Writing files',
      archiving: 'Building archive',
      uploading: 'Uploading archive',
      delivering: 'Sending to your DMs',
      cleanup: 'Cleaning up'
    };

    const renderProgress = () => {
      const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
      const clock = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
      const bar = (frac) => {
        const filled = Math.max(0, Math.min(12, Math.round(frac * 12)));
        return `\`[${'█'.repeat(filled)}${'░'.repeat(12 - filled)}]\``;
      };

      const lines = [`**Export — ${STAGE_LABEL[job.stage] || job.stage}** · ${clock}`];

      if (job.channelsTotal > 1) {
        lines.push(`${bar(job.channelsDone / job.channelsTotal)} channels ${job.channelsDone}/${job.channelsTotal}`);
      }
      if (job.currentChannel) {
        const inChannel = job.stage === 'scraping' && job.channelMessages ? ` — ${job.channelMessages} matched here` : '';
        lines.push(`Current: **#${job.currentChannel}**${inChannel}`);
      }
      lines.push(`Messages: **${job.totalMessages + (job.channelMessages || 0)}** collected · ${job.scanned} scanned`);
      if (withMedia) {
        const media = `Media: **${job.mediaFiles}** file(s), ${humanBytes(job.mediaBytes)}` +
          (job.mediaSkipped ? ` · ${job.mediaSkipped} skipped` : '');
        lines.push(job.stage === 'media' && job.mediaPending
          ? `${media} (${job.mediaDone || 0}/${job.mediaPending} in this channel)`
          : media);
      }
      if (job.stage === 'archiving' && job.zipTotal) {
        lines.push(`${bar(job.zipDone / job.zipTotal)} packing ${job.zipDone}/${job.zipTotal} files`);
      }
      if (job.stage === 'uploading') lines.push(`Sending ${humanBytes(job.zipSize)} to bashupload.app…`);
      if (job.hitLimit) lines.push(`_Message cap (${job.limit}) reached — export will be truncated._`);
      if (job.cancelled) lines.push('_Cancellation requested — stopping after this step._');
      return lines.join('\n');
    };

    let lastProgress = 0;
    const progress = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastProgress < limits.progressIntervalMs) return;
      lastProgress = now;
      await interaction.editReply(renderProgress()).catch(() => {});
    };

    const windowLabel = `${fromTs === 0 ? 'beginning of history' : new Date(fromTs).toISOString()} → ${new Date(toTs).toISOString()}`;
    let cleanedUp = false;

    try {
      ensureDir(workDir);
      const channelsDir = path.join(workDir, 'channels');
      const mediaRoot = path.join(workDir, 'media');
      ensureDir(channelsDir);

      const perChannel = [];

      await progress(true);

      for (const ch of channels) {
        if (job.cancelled) break;
        job.stage = 'scraping';
        job.currentChannel = ch.name;
        job.channelMessages = 0;
        await progress();

        const messages = await scrapeChannel(ch, job, limits, progress);

        if (withMedia && messages.length && !job.cancelled) {
          job.stage = 'media';
          job.mediaDone = 0;
          await progress(true);
          await downloadMedia(messages, ch, job, mediaRoot, limits, async () => {
            job.mediaDone = (job.mediaDone || 0) + 1;
            await progress();
          });
        }

        job.totalMessages += messages.length;
        job.channelMessages = 0;
        job.mediaPending = 0;
        job.channelsDone++;

        if (messages.length) {
          const base = `${safeName(ch.name, 'channel')}-${ch.id}`;
          if (format === 'json' || format === 'both') {
            fs.writeFileSync(path.join(channelsDir, `${base}.json`), JSON.stringify({
              channel: { id: ch.id, name: ch.name, type: ch.type, parentId: ch.parentId || null },
              window: { fromTs, toTs, label: windowLabel },
              count: messages.length,
              messages
            }, null, 2), 'utf8');
          }
          if (format === 'txt' || format === 'both') {
            fs.writeFileSync(path.join(channelsDir, `${base}.txt`), renderText(`#${ch.name} (${ch.id})`, messages), 'utf8');
          }
          perChannel.push({ id: ch.id, name: ch.name, messages: messages.length });
        }
      }

      if (job.cancelled) {
        removeInsideExportBase(workDir);
        cleanedUp = true;
        jobs.delete(guild.id);
        await interaction.editReply('Export cancelled — local files removed, nothing was uploaded.').catch(() => {});
        return;
      }

      if (!job.totalMessages) {
        removeInsideExportBase(workDir);
        cleanedUp = true;
        jobs.delete(guild.id);
        await interaction.editReply(`No messages matched (${windowLabel}${targetUser ? `, user ${targetUser.tag}` : ''}). Nothing exported.`).catch(() => {});
        return;
      }

      const manifest = {
        generatedAt: new Date().toISOString(),
        guild: { id: guild.id, name: guild.name },
        requestedBy: { id: interaction.user.id, tag: interaction.user.tag },
        configuration: {
          scope,
          channel: scope === 'channel' ? channels[0]?.id : null,
          user: targetUser ? { id: targetUser.id, tag: targetUser.tag } : 'all users',
          media: withMedia,
          threads: includeThreads
            ? 'active threads and forum posts included; archived threads excluded'
            : 'text channels only (threads and forum posts excluded)',
          format,
          limit: maxMessages,
          window: { from: fromTs === 0 ? 'beginning' : new Date(fromTs).toISOString(), to: new Date(toTs).toISOString() }
        },
        totals: {
          channelsExported: perChannel.length,
          channelsScanned: job.channelsDone,
          messages: job.totalMessages,
          messagesScanned: job.scanned,
          mediaFiles: job.mediaFiles,
          mediaBytes: job.mediaBytes,
          mediaSkipped: job.mediaSkipped,
          messageLimitReached: job.hitLimit,
          mediaBudgetReached: job.mediaBudgetHit
        },
        channels: perChannel,
        errors: job.errors.slice(0, 200)
      };
      fs.writeFileSync(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

      const summary = [
        `Universal Discord Bot — message export`,
        `Generated: ${manifest.generatedAt}`,
        `Server:    ${guild.name} (${guild.id})`,
        `Requested: ${interaction.user.tag}`,
        ``,
        `Scope:     ${scope}${scope === 'channel' ? ` (#${channels[0]?.name})` : ''}`,
        `User:      ${targetUser ? targetUser.tag : 'all users'}`,
        `Window:    ${windowLabel}`,
        `Media:     ${withMedia ? `yes — ${job.mediaFiles} file(s), ${humanBytes(job.mediaBytes)}` : 'no'}`,
        `Threads:   ${manifest.configuration.threads}`,
        ``,
        `Messages:  ${job.totalMessages} across ${perChannel.length} channel(s)`,
        job.hitLimit ? `NOTE: the ${maxMessages} message safety cap was reached — the export is truncated.` : '',
        job.mediaBudgetHit ? `NOTE: the media size budget was reached — some attachments were skipped.` : '',
        job.errors.length ? `\nErrors (${job.errors.length}):\n${job.errors.slice(0, 50).map(e => `  - ${e}`).join('\n')}` : ''
      ].filter(Boolean).join('\n');
      fs.writeFileSync(path.join(workDir, 'summary.txt'), summary, 'utf8');

      // ---- archive ----
      job.stage = 'archiving';
      lastProgress = 0;
      await progress(true);
      const zipInfo = await createZip(workDir, zipPath, async (done, total) => {
        job.zipDone = done;
        job.zipTotal = total;
        await progress();
      });
      job.zipSize = zipInfo.size;

      const header = [
        `**Export ready — ${guild.name}**`,
        '',
        `Scope: ${scope}${scope === 'channel' ? ` (#${channels[0]?.name})` : ''}`,
        `User: ${targetUser ? targetUser.tag : 'all users'}`,
        `Window: ${windowLabel}`,
        `Messages: ${job.totalMessages} across ${perChannel.length} channel(s)`,
        withMedia ? `Media: ${job.mediaFiles} file(s), ${humanBytes(job.mediaBytes)}` : 'Media: not included',
        `Archive: \`${path.basename(zipPath)}\` (${humanBytes(zipInfo.size)}, ${zipInfo.files} files)`
      ];

      // Small archives go straight to Discord — no third party involved, no
      // expiring link. bashupload is only for what Discord will not accept.
      const fitsInDm = zipInfo.size <= limits.directAttachmentMaxBytes;
      let delivered = false;
      let deliveryNote = '';

      if (fitsInDm) {
        job.stage = 'delivering';
        await progress(true);
        try {
          await interaction.user.send({
            content: [...header, '', '_Archive attached directly — nothing was uploaded to any third-party host._'].join('\n'),
            files: [{ attachment: zipPath, name: path.basename(zipPath) }]
          });
          delivered = true;
          deliveryNote = 'attached to your DM directly';
          console.log(`[export] ${guild.name}: delivered ${path.basename(zipPath)} (${humanBytes(zipInfo.size)}) as a DM attachment`);
        } catch (attachError) {
          // Discord refused it (size ceiling differs per server tier) — fall
          // through to the upload path rather than failing the export.
          console.warn(`[export] direct attachment failed (${attachError.message}); falling back to bashupload.app`);
          job.errors.push(`direct DM attachment failed: ${attachError.message}`);
        }
      }

      if (!delivered) {
        // ---- upload ----
        job.stage = 'uploading';
        lastProgress = 0;
        await progress(true);
        const uploaded = await uploadArchive(zipPath, limits.uploadTimeoutMs);

        // Log unconditionally: on a long export the interaction token is already
        // dead, and a failed DM must not lose the response.
        console.log(`[export] ${guild.name}: uploaded ${path.basename(zipPath)} (${humanBytes(zipInfo.size)}, via ${uploaded.via}) — response:\n${uploaded.raw}`);

        job.stage = 'delivering';
        await progress(true);
        try {
          await interaction.user.send({
            content: [
              ...header,
              '',
              `Too large to attach (limit ${humanBytes(limits.directAttachmentMaxBytes)}), so it went to bashupload.app.`,
              '**Raw response from the upload — the download link is single use:**',
              '```',
              uploaded.raw.slice(0, 1500),
              '```'
            ].join('\n')
          });
          delivered = true;
          deliveryNote = 'uploaded to bashupload.app, response sent to your DMs';
        } catch (dmError) {
          // Delivery failed, so the "then and only then" precondition is unmet:
          // keep every local file so nothing is lost.
          job.stage = 'dm-failed';
          jobs.delete(guild.id);
          console.error(`[export] DM to ${interaction.user.tag} failed: ${dmError.message}. Files kept at ${workDir}. Response was:\n${uploaded.raw}`);
          await interaction.editReply(
            `Upload succeeded but I could not DM you (${dmError.message}). Local files were **kept** at \`${workDir}\`.\n\`\`\`\n${uploaded.raw.slice(0, 1500)}\n\`\`\``
          ).catch(() => {});
          return;
        }
      }

      if (!delivered) {
        job.stage = 'dm-failed';
        jobs.delete(guild.id);
        await interaction.editReply(`Could not deliver the export. Local files were **kept** at \`${workDir}\`.`).catch(() => {});
        return;
      }

      // ---- cleanup, only now that everything before it succeeded ----
      job.stage = 'cleanup';
      removeInsideExportBase(workDir);
      removeInsideExportBase(zipPath);
      cleanedUp = true;

      jobs.delete(guild.id);
      await interaction.editReply([
        `**Export complete** — ${job.totalMessages} message(s) across ${perChannel.length} channel(s).`,
        `Archive: \`${path.basename(zipPath)}\` (${humanBytes(zipInfo.size)}, ${zipInfo.files} files) — ${deliveryNote}.`,
        withMedia ? `Media: ${job.mediaFiles} file(s), ${humanBytes(job.mediaBytes)}.` : '',
        'Local copies deleted.'
      ].filter(Boolean).join('\n')).catch(() => {});
    } catch (e) {
      jobs.delete(guild.id);
      console.error('[export] failed:', e);
      const kept = cleanedUp ? '' : ` Local files kept at \`${workDir}\` for inspection.`;
      await interaction.editReply(`Export failed: ${e.message}.${kept}`).catch(() => {});
    }
  },

  // Exposed for tests / manual verification; not used by the command path.
  _internals: {
    createZip, crc32, extractLink, resolveInstant, timestampToSnowflake,
    safeName, humanBytes, putFile, uploadArchive, removeInsideExportBase, EXPORT_BASE
  }
};
