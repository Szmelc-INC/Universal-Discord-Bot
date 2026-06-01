const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseTimeframe(str) {
  const m = str.match(/^(\d+)([smhd])$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[u] || 1;
  return new Date(Date.now() - n * mult * 1000);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (e) => { try { fs.unlinkSync(dest); } catch {}; reject(e); });
    }).on('error', (e) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {};
      reject(e);
    });
  });
}

async function collectMatching(channel, cutoff, userId) {
  const matches = [];
  let before = null;
  const max = 5000;
  while (matches.length < max) {
    const opts = { limit: 100 };
    if (before) opts.before = before;
    let fetched;
    try {
      fetched = await channel.messages.fetch(opts);
    } catch {
      break;
    }
    if (!fetched.size) break;
    for (const m of fetched.values()) {
      if (m.createdTimestamp >= cutoff.getTime()) {
        if (!userId || m.author.id === userId) matches.push(m);
      }
    }
    before = fetched.lastKey();
    if (fetched.size < 100) break;
  }
  return matches;
}

async function backupMessages(channel, matches, guildId) {
  ensureDir(BACKUP_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${guildId}_${channel.id}_${ts}`;
  const txtPath = path.join(BACKUP_DIR, `${base}.txt`);
  const filesDir = path.join(BACKUP_DIR, `${base}_files`);
  ensureDir(filesDir);
  const lines = [];
  let savedFiles = 0;
  for (const m of matches.slice().reverse()) {
    const t = m.createdAt.toISOString();
    lines.push(`${t} | ${m.author.tag} (${m.author.id}): ${m.content || ''}`);
    for (const att of m.attachments.values()) {
      lines.push(`  [ATTACHMENT] ${att.name} (${att.size}B) ${att.url}`);
      if (att.size && att.size < 8 * 1024 * 1024) {
        try {
          const ext = path.extname(att.name || 'file') || '.bin';
          const safe = `${m.id}_${att.id}${ext}`.replace(/[^a-z0-9_.-]/gi, '_');
          const dest = path.join(filesDir, safe);
          await downloadFile(att.proxyURL || att.url, dest);
          lines.push(`  [SAVED] ${safe}`);
          savedFiles++;
        } catch {}
      }
    }
  }
  fs.writeFileSync(txtPath, lines.join('\n'), 'utf8');
  const hasFiles = fs.existsSync(filesDir) && fs.readdirSync(filesDir).length > 0;
  return { txtPath, filesDir: hasFiles ? filesDir : null, count: matches.length, savedFiles };
}

async function deleteBatch(channel, messages) {
  if (!messages.length) return 0;
  const now = Date.now();
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
  const bulkable = messages.filter(m => (now - m.createdTimestamp) < FOURTEEN_DAYS);
  const old = messages.filter(m => (now - m.createdTimestamp) >= FOURTEEN_DAYS);
  let deleted = 0;
  if (bulkable.length) {
    try {
      const res = await channel.bulkDelete(bulkable, true);
      deleted += res.size || bulkable.length;
    } catch {
      for (const m of bulkable) {
        try {
          await m.delete();
          deleted++;
          await new Promise(r => setTimeout(r, 200));
        } catch {}
      }
    }
  }
  for (const m of old) {
    try {
      await m.delete();
      deleted++;
      await new Promise(r => setTimeout(r, 400));
    } catch {}
  }
  return deleted;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rm')
    .setDescription('Advanced message cleanup (shredder)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sc => sc
      .setName('channel')
      .setDescription('Clean messages in this channel within time window')
      .addStringOption(o => o.setName('time').setDescription('Time window e.g. 30s, 15m, 2h, 1d').setRequired(true))
      .addBooleanOption(o => o.setName('backup').setDescription('Backup matching messages before delete')))
    .addSubcommand(sc => sc
      .setName('global')
      .setDescription('Clean messages across all text channels in the server')
      .addStringOption(o => o.setName('time').setDescription('Time window e.g. 30s, 15m, 2h, 1d').setRequired(true))
      .addBooleanOption(o => o.setName('backup').setDescription('Backup matching messages before delete')))
    .addSubcommand(sc => sc
      .setName('user')
      .setDescription('Clean messages by a specific user in this channel')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption(o => o.setName('time').setDescription('Time window e.g. 30s, 15m, 2h, 1d').setRequired(true))
      .addBooleanOption(o => o.setName('backup').setDescription('Backup matching messages before delete'))),
  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Unauthorized.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    const scope = sub;
    const timeStr = interaction.options.getString('time');
    const doBackup = interaction.options.getBoolean('backup') || false;
    const targetUser = scope === 'user' ? interaction.options.getUser('user') : null;
    const cutoff = parseTimeframe(timeStr);
    if (!cutoff) {
      await interaction.reply({ content: 'Invalid time format. Examples: 30s, 15m, 2h, 1d', flags: MessageFlags.Ephemeral });
      return;
    }
    if (scope === 'user' && !targetUser) {
      await interaction.reply({ content: 'User is required for user scope.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }
    const userIdFilter = targetUser ? targetUser.id : null;
    const filterFn = (m) => m.createdTimestamp >= cutoff.getTime() && (!userIdFilter || m.author.id === userIdFilter);
    let totalDeleted = 0;
    let channelsTouched = 0;
    let errorCount = 0;
    const backupResults = [];
    try {
      const chans = scope === 'global'
        ? [...guild.channels.cache.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).values()]
        : [interaction.channel].filter(Boolean);
      const me = guild.members.me;
      for (const ch of chans) {
        if (!ch || ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) continue;
        const perms = ch.permissionsFor(me);
        if (!perms || !perms.has(PermissionFlagsBits.ReadMessageHistory) || !perms.has(PermissionFlagsBits.ManageMessages)) {
          continue;
        }
        let matches = [];
        if (doBackup) {
          try {
            matches = await collectMatching(ch, cutoff, userIdFilter);
            if (matches.length) {
              const b = await backupMessages(ch, matches, guild.id);
              backupResults.push(b);
            }
          } catch (e) {
            errorCount++;
          }
        }
        // delete pass
        try {
          let before = null;
          while (true) {
            const opts = { limit: 100 };
            if (before) opts.before = before;
            let fetched;
            try {
              fetched = await ch.messages.fetch(opts);
            } catch {
              errorCount++;
              break;
            }
            if (!fetched.size) break;
            const batch = [];
            for (const m of fetched.values()) {
              if (filterFn(m)) batch.push(m);
            }
            before = fetched.lastKey();
            if (batch.length) {
              const del = await deleteBatch(ch, batch);
              totalDeleted += del;
            }
            if (fetched.size < 100) break;
          }
        } catch (e) {
          errorCount++;
        }
        channelsTouched++;
        if (doBackup) {
          await interaction.editReply(`Backed up + cleaned #${ch.name} (total deleted: ${totalDeleted})`).catch(() => {});
        } else {
          await interaction.editReply(`Cleaned #${ch.name} (total deleted: ${totalDeleted})`).catch(() => {});
        }
      }
      let summary = `Done. Deleted ${totalDeleted} message(s) across ${channelsTouched} channel(s).`;
      if (errorCount) summary += ` Errors: ${errorCount}.`;
      if (backupResults.length) {
        summary += ` Backed up ${backupResults.length} log(s).`;
        try {
          const u = interaction.user;
          for (const br of backupResults) {
            const files = [br.txtPath];
            await u.send({ content: `rm backup: ${path.basename(br.txtPath)}`, files }).catch(() => {});
            if (br.filesDir) {
              await u.send(`Attachments saved on host: ${br.filesDir}`).catch(() => {});
            }
          }
        } catch {}
      }
      await interaction.editReply(summary);
    } catch (e) {
      await interaction.editReply(`Cleanup failed: ${e.message || e}`).catch(() => {});
      console.error(e);
    }
  }
};
