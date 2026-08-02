const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  MessageFlags,
  InteractionContextType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const MODULE_NAME = 'democracy';
const RUNTIME_KEY = '_democracy';
const CONFIG_FILE = path.join(__dirname, '..', 'config', 'democracy.json');
const STATE_FILE = path.join(__dirname, '..', 'config', 'democracy-state.json');

// ---------------------------------------------------------------------------
// Config (reguły) + State (aktywne głosowania, historia, subskrypcje DM)
// ---------------------------------------------------------------------------

function defaultConfig() {
  return {
    enabled: true,
    voteChannelId: null,
    createEvents: true,
    notifyDefault: false,
    adminUserIds: [],
    adminRoleIds: [],
    protected: { userIds: [], roleIds: [] },
    passRatio: 0.5,
    activeMemberRatio: 0.05,
    forbiddenPermissions: ['Administrator'],
    defaults: { minVotes: 3, minDurationSec: 1800, maxDurationSec: 604800 },
    categories: {}
  };
}

function loadConfig() {
  const base = defaultConfig();
  try {
    if (!fs.existsSync(CONFIG_FILE)) return base;
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      ...base,
      ...raw,
      protected: { ...base.protected, ...(raw.protected || {}) },
      defaults: { ...base.defaults, ...(raw.defaults || {}) },
      categories: { ...base.categories, ...(raw.categories || {}) }
    };
  } catch (e) {
    console.error(`[${MODULE_NAME}] Nie udało się odczytać configu:`, e.message);
    return base;
  }
}

function defaultState() {
  return { seq: 0, active: {}, history: [], notify: {} };
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return defaultState();
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      seq: Number(raw.seq) || 0,
      active: raw.active && typeof raw.active === 'object' ? raw.active : {},
      history: Array.isArray(raw.history) ? raw.history : [],
      notify: raw.notify && typeof raw.notify === 'object' ? raw.notify : {}
    };
  } catch (e) {
    console.error(`[${MODULE_NAME}] Nie udało się odczytać stanu:`, e.message);
    return defaultState();
  }
}

let config = loadConfig();
let state = loadState();

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error(`[${MODULE_NAME}] Nie udało się zapisać configu:`, e.message);
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error(`[${MODULE_NAME}] Nie udało się zapisać stanu:`, e.message);
  }
}

// ---------------------------------------------------------------------------
// Uprawnienia głosowalne (lista bez Administrator i innych zakazanych)
// ---------------------------------------------------------------------------

function forbiddenSet() {
  return new Set((config.forbiddenPermissions || ['Administrator']).map(p => String(p).toLowerCase()));
}

function votablePermissions() {
  const forbidden = forbiddenSet();
  return Object.keys(PermissionFlagsBits).filter(p => !forbidden.has(p.toLowerCase()));
}

function resolvePermissionName(input) {
  if (!input) return null;
  const target = String(input).toLowerCase();
  return Object.keys(PermissionFlagsBits).find(p => p.toLowerCase() === target) || null;
}

// ---------------------------------------------------------------------------
// Pomocnicze: czas, formatowanie
// ---------------------------------------------------------------------------

function parseDuration(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d+)\s*([smhdw])$/i);
  if (!m) {
    const n = Number(str);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null; // gołe sekundy
  }
  const value = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[unit];
  return value * mult;
}

function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !d && !h) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// ---------------------------------------------------------------------------
// Admini / immunitet
// ---------------------------------------------------------------------------

function isDemocracyAdmin(interaction) {
  const member = interaction.member || interaction.user;
  if (interaction.client.isAdmin?.(member)) return true;
  const userId = member?.id || member?.user?.id;
  if ((config.adminUserIds || []).includes(userId)) return true;
  const roles = interaction.member?.roles?.cache;
  if (roles && (config.adminRoleIds || []).length) {
    for (const role of roles.values()) {
      if (config.adminRoleIds.includes(role.id)) return true;
    }
  }
  return false;
}

// Czy członek jest immunizowany (nie można go banować/kickować/timeoutować, ani zmieniać ról)
function isImmuneMember(client, guild, member) {
  if (!member) return false;
  if (member.id === guild.ownerId) return true;
  if (client.isAdmin?.(member)) return true;
  if ((config.adminUserIds || []).includes(member.id)) return true;
  if ((config.protected?.userIds || []).includes(member.id)) return true;
  const roleIds = new Set([...(config.adminRoleIds || []), ...(config.protected?.roleIds || [])]);
  if (roleIds.size && member.roles.cache.some(r => roleIds.has(r.id))) return true;
  return false;
}

function isProtectedRole(roleId) {
  return (config.protected?.roleIds || []).includes(roleId) || (config.adminRoleIds || []).includes(roleId);
}

// ---------------------------------------------------------------------------
// Progi / kategorie
// ---------------------------------------------------------------------------

function categoryRule(category) {
  const cat = (config.categories || {})[category];
  const def = config.defaults || { minVotes: 3, minDurationSec: 1800, maxDurationSec: 604800 };
  return {
    minVotes: cat?.minVotes ?? def.minVotes,
    minDurationSec: cat?.minDurationSec ?? def.minDurationSec,
    maxDurationSec: cat?.maxDurationSec ?? def.maxDurationSec
  };
}

// Próg głosów skalowany liczbą członków serwera, z podłogą = wartość z configu.
function resolveMinVotes(category, guild) {
  const rule = categoryRule(category);
  const scaled = Math.round((guild?.memberCount || 0) * (config.activeMemberRatio || 0));
  return Math.max(rule.minVotes, scaled);
}

// ---------------------------------------------------------------------------
// Renderowanie
// ---------------------------------------------------------------------------

function tally(vote) {
  let f = 0, a = 0, ab = 0;
  for (const v of Object.values(vote.votes || {})) {
    if (v === 'for') f++;
    else if (v === 'against') a++;
    else if (v === 'abstain') ab++;
  }
  return { for: f, against: a, abstain: ab, total: f + a + ab };
}

function voteButtons(voteId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dem:${voteId}:for`).setLabel('ZA').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`dem:${voteId}:against`).setLabel('PRZECIW').setStyle(ButtonStyle.Danger).setEmoji('❌').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`dem:${voteId}:abstain`).setLabel('WSTRZYMUJĘ SIĘ').setStyle(ButtonStyle.Secondary).setEmoji('🤝').setDisabled(disabled)
  );
}

function statusLabel(status) {
  return {
    active: '🟢 Trwa',
    passed: '✅ Przyjęto',
    executed: '✅ Przyjęto i wykonano',
    failed: '❌ Odrzucono',
    cancelled: '🛑 Anulowano',
    error: '⚠️ Przyjęto, ale wykonanie nie powiodło się'
  }[status] || status;
}

function voteEmbed(vote) {
  const t = tally(vote);
  const need = vote.minVotes;
  const quorumOk = t.total >= need;
  const ratio = (t.for + t.against) > 0 ? t.for / (t.for + t.against) : 0;
  const embed = new EmbedBuilder()
    .setTitle(`🗳️ Głosowanie #${vote.id} — ${vote.title}`)
    .setColor(vote.status === 'active' ? 0x5865f2 : (vote.status === 'passed' || vote.status === 'executed' ? 0x57f287 : (vote.status === 'error' ? 0xfaa61a : 0xed4245)))
    .setDescription(vote.description || '—')
    .addFields(
      { name: 'Wnioskodawca', value: `<@${vote.starterId}>`, inline: true },
      { name: 'Status', value: statusLabel(vote.status), inline: true },
      { name: 'Kategoria', value: `\`${vote.category}\``, inline: true },
      { name: '✅ ZA', value: String(t.for), inline: true },
      { name: '❌ PRZECIW', value: String(t.against), inline: true },
      { name: '🤝 WSTRZYMANE', value: String(t.abstain), inline: true },
      {
        name: 'Wymagania',
        value: `Kworum: **${t.total}/${need}** ${quorumOk ? '✅' : '⏳'}\nWiększość ZA: **${Math.round(ratio * 100)}%** (wymagane ${Math.round((vote.passRatio || 0.5) * 100)}%)`,
        inline: false
      }
    );
  if (vote.reason) embed.addFields({ name: '📝 Uzasadnienie', value: vote.reason.slice(0, 1024), inline: false });
  const startedTs = Math.floor(vote.startedAt / 1000);
  const endsTs = Math.floor(vote.endsAt / 1000);
  embed.addFields({
    name: 'Czas',
    value: `Start: <t:${startedTs}:f>\nKoniec: <t:${endsTs}:f> (<t:${endsTs}:R>)`,
    inline: false
  });
  embed.setFooter({ text: `ID: ${vote.id} • głosy są tajne, widoczne tylko dla admina` });
  return embed;
}

// Krótki opis akcji do raportu / tytułu eventu
function describeAction(action) {
  switch (action.kind) {
    case 'moderation': {
      const map = { timeout: 'Timeout', untimeout: 'Zdjęcie timeoutu', kick: 'Kick', ban: 'Ban', unban: 'Unban' };
      let d = `${map[action.op] || action.op} użytkownika <@${action.targetUserId}>`;
      if (action.op === 'timeout' && action.punishSec) d += ` na ${formatDuration(action.punishSec)}`;
      return d;
    }
    case 'role': {
      const m = {
        create: `Utworzenie roli „${action.name}" (bez uprawnień)`,
        delete: `Usunięcie roli <@&${action.roleId}>`,
        assign: `Nadanie roli <@&${action.roleId}> użytkownikowi <@${action.targetUserId}>`,
        unassign: `Odebranie roli <@&${action.roleId}> użytkownikowi <@${action.targetUserId}>`,
        permission: `Ustawienie uprawnienia \`${action.permission}\` = **${action.value}** dla roli <@&${action.roleId}>`,
        rename: `Zmiana nazwy roli <@&${action.roleId}> na „${action.value}"`,
        recolor: `Zmiana koloru roli <@&${action.roleId}> na ${action.value}`,
        hoist: `Wyświetlanie roli <@&${action.roleId}> osobno = **${action.value}**`,
        mentionable: `Oznaczalność roli <@&${action.roleId}> = **${action.value}**`
      };
      return m[action.op] || action.op;
    }
    case 'channel': {
      const m = {
        create: `Utworzenie kanału „${action.name}" (${action.channelType})`,
        delete: `Usunięcie kanału <#${action.channelId}>`,
        permission: `Uprawnienie \`${action.permission}\` = **${action.permState}** dla ${action.targetMention} na <#${action.channelId}>`,
        rename: `Zmiana nazwy kanału <#${action.channelId}> na „${action.value}"`,
        topic: `Zmiana tematu kanału <#${action.channelId}>`,
        nsfw: `NSFW kanału <#${action.channelId}> = **${action.value}**`,
        slowmode: `Slowmode kanału <#${action.channelId}> = ${action.value}s`
      };
      return m[action.op] || action.op;
    }
    case 'server':
      return `Zmiana ustawienia serwera \`${action.setting}\` na „${action.value}"`;
    case 'asset': {
      const t = action.assetType === 'sticker' ? 'naklejki' : 'emoji';
      return action.op === 'add' ? `Dodanie ${t} „${action.name}"` : `Usunięcie ${t} \`${action.id || action.name}\``;
    }
    default:
      return 'Nieznana akcja';
  }
}

// ---------------------------------------------------------------------------
// Cykl życia głosowania
// ---------------------------------------------------------------------------

const timers = new Map(); // voteId -> timeout handle

function clearVoteTimer(voteId) {
  const h = timers.get(voteId);
  if (h) { clearTimeout(h); timers.delete(voteId); }
}

function scheduleFinalize(client, vote) {
  clearVoteTimer(vote.id);
  const delay = vote.endsAt - Date.now();
  if (delay <= 0) {
    finalizeVote(client, vote.id, 'czas minął').catch(e => console.error(`[${MODULE_NAME}]`, e));
    return;
  }
  const h = setTimeout(() => {
    finalizeVote(client, vote.id, 'czas minął').catch(e => console.error(`[${MODULE_NAME}]`, e));
  }, Math.min(delay, 2 ** 31 - 1));
  if (typeof h.unref === 'function') h.unref();
  timers.set(vote.id, h);
}

async function resolveVoteChannel(interaction) {
  const guild = interaction.guild;
  if (config.voteChannelId) {
    const ch = await guild.channels.fetch(config.voteChannelId).catch(() => null);
    if (ch && ch.isTextBased()) return ch;
  }
  // fallback: kanał, w którym wywołano komendę
  return interaction.channel;
}

async function createVote(interaction, category, action, title) {
  const guild = interaction.guild;
  const admin = isDemocracyAdmin(interaction);
  const rule = categoryRule(category);

  // Długość głosowania
  const requested = parseDuration(interaction.options.getString('vote_length'));
  let durationSec;
  if (requested == null) {
    durationSec = rule.minDurationSec;
  } else if (admin) {
    durationSec = Math.max(1, requested); // admin: bez ograniczeń
  } else {
    durationSec = clampInt(requested, rule.minDurationSec, rule.maxDurationSec, rule.minDurationSec);
  }

  // Próg głosów
  let minVotes = resolveMinVotes(category, guild);
  const ovMinVotes = interaction.options.getInteger('ov_min_votes');
  if (ovMinVotes != null && admin) minVotes = Math.max(1, ovMinVotes);

  const now = Date.now();
  state.seq += 1;
  const id = state.seq;
  const reason = (interaction.options.getString('reason') || '').slice(0, 250);

  const vote = {
    id,
    guildId: guild.id,
    category,
    action,
    title: title.slice(0, 100),
    description: describeAction(action),
    starterId: interaction.user.id,
    reason,
    startedAt: now,
    endsAt: now + durationSec * 1000,
    durationSec,
    minVotes,
    passRatio: config.passRatio ?? 0.5,
    votes: {},
    status: 'active',
    adminStarted: admin,
    anchorChannelId: null,
    threadId: null,
    messageId: null,
    eventId: null
  };

  // Publikacja: wiadomość + wątek + poll (embed z przyciskami)
  const voteChannel = await resolveVoteChannel(interaction);
  if (!voteChannel) throw new Error('Brak kanału do publikacji głosowania (ustaw voteChannelId).');

  const brief =
    `🗳️ **Nowe głosowanie #${id}** — ${vote.title}\n` +
    `> ${vote.description}\n` +
    `Wnioskodawca: <@${vote.starterId}> • Kończy się: <t:${Math.floor(vote.endsAt / 1000)}:R>`;

  const anchor = await voteChannel.send({ content: brief });
  vote.anchorChannelId = anchor.channelId;

  let thread;
  try {
    thread = await anchor.startThread({
      name: `Głosowanie #${id} — ${vote.title}`.slice(0, 100),
      autoArchiveDuration: 10080
    });
  } catch (e) {
    // fallback: bez wątku, głosowanie w kanale
    console.warn(`[${MODULE_NAME}] Nie udało się utworzyć wątku: ${e.message}`);
  }

  const target = thread || voteChannel;
  const voteMsg = await target.send({ embeds: [voteEmbed(vote)], components: [voteButtons(id)] });
  vote.threadId = thread ? thread.id : null;
  vote.messageId = voteMsg.id;
  vote.anchorMessageId = anchor.id;
  if (!thread) vote.messageChannelId = voteChannel.id;

  // Server Event (kosmetyczne, best-effort)
  if (config.createEvents) {
    try {
      const ev = await guild.scheduledEvents.create({
        name: `🗳️ #${id} ${vote.title}`.slice(0, 100),
        scheduledStartTime: new Date(now + 5000),
        scheduledEndTime: new Date(vote.endsAt),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: `Głosowanie #${id}` },
        description: `${vote.description}\n\nWnioskodawca: ${interaction.user.tag}${reason ? `\nUzasadnienie: ${reason}` : ''}`.slice(0, 1000)
      });
      vote.eventId = ev.id;
    } catch (e) {
      console.warn(`[${MODULE_NAME}] Nie udało się utworzyć eventu: ${e.message}`);
    }
  }

  state.active[String(id)] = vote;
  saveState();
  scheduleFinalize(interaction.client, vote);
  notifySubscribers(interaction.client, vote).catch(() => {});

  return { vote, thread, voteChannel };
}

async function updateVoteMessage(client, vote, disabled = false) {
  try {
    let channel;
    if (vote.threadId) channel = await client.channels.fetch(vote.threadId).catch(() => null);
    else channel = await client.channels.fetch(vote.messageChannelId || vote.anchorChannelId).catch(() => null);
    if (!channel) return;
    if (channel.archived) { try { await channel.setArchived(false); } catch { /* ignore */ } }
    const msg = await channel.messages.fetch(vote.messageId).catch(() => null);
    if (!msg) return;
    await msg.edit({ embeds: [voteEmbed(vote)], components: disabled ? [voteButtons(vote.id, true)] : [voteButtons(vote.id)] });
  } catch (e) {
    console.warn(`[${MODULE_NAME}] Nie udało się zaktualizować wiadomości głosowania #${vote.id}: ${e.message}`);
  }
}

async function postThreadNotice(client, vote, content) {
  try {
    const chId = vote.threadId || vote.messageChannelId || vote.anchorChannelId;
    const channel = await client.channels.fetch(chId).catch(() => null);
    if (!channel) return;
    if (channel.archived) { try { await channel.setArchived(false); } catch { /* ignore */ } }
    await channel.send({ content: content.slice(0, 2000) });
  } catch { /* best-effort */ }
}

async function cleanupEvent(client, vote) {
  if (!vote.eventId) return;
  try {
    const guild = await client.guilds.fetch(vote.guildId).catch(() => null);
    if (!guild) return;
    const ev = await guild.scheduledEvents.fetch(vote.eventId).catch(() => null);
    if (ev) await ev.delete().catch(() => {});
  } catch { /* ignore */ }
}

function archiveVote(vote) {
  const t = tally(vote);
  const record = {
    id: vote.id,
    guildId: vote.guildId,
    category: vote.category,
    title: vote.title,
    description: vote.description,
    starterId: vote.starterId,
    reason: vote.reason,
    startedAt: vote.startedAt,
    endedAt: Date.now(),
    minVotes: vote.minVotes,
    passRatio: vote.passRatio,
    result: vote.status,
    tally: t,
    votes: vote.votes, // pełny zapis kto jak głosował (widoczny tylko dla admina)
    action: vote.action,
    error: vote.error || null
  };
  state.history.unshift(record);
  if (state.history.length > 500) state.history.length = 500;
}

async function finalizeVote(client, voteId, reason) {
  const key = String(voteId);
  const vote = state.active[key];
  if (!vote || vote.status !== 'active') return;
  clearVoteTimer(voteId);

  const t = tally(vote);
  const quorumOk = t.total >= vote.minVotes;
  const decided = t.for + t.against;
  const ratio = decided > 0 ? t.for / decided : 0;
  const passed = quorumOk && decided > 0 && ratio >= (vote.passRatio ?? 0.5) && t.for > t.against;

  vote.status = passed ? 'passed' : 'failed';

  let execMsg = '';
  if (passed) {
    try {
      const result = await executeAction(client, vote);
      vote.status = 'executed';
      execMsg = `\n✅ Wykonano: ${result}`;
    } catch (e) {
      vote.status = 'error';
      vote.error = e.message;
      execMsg = `\n⚠️ Wykonanie nie powiodło się: ${e.message}`;
      console.error(`[${MODULE_NAME}] Błąd wykonania głosowania #${voteId}:`, e.message);
    }
  }

  await updateVoteMessage(client, vote, true);
  const verdict = passed
    ? `**PRZYJĘTO** (${t.for} ZA / ${t.against} PRZECIW, kworum ${t.total}/${vote.minVotes})`
    : `**ODRZUCONO** (${t.for} ZA / ${t.against} PRZECIW, kworum ${t.total}/${vote.minVotes}${quorumOk ? '' : ' — brak kworum'})`;
  await postThreadNotice(client, vote, `🏁 Głosowanie #${vote.id} zakończone (${reason}).\n${verdict}${execMsg}`);
  await cleanupEvent(client, vote);

  archiveVote(vote);
  delete state.active[key];
  saveState();
}

async function cancelVote(client, voteId, byAdminId) {
  const key = String(voteId);
  const vote = state.active[key];
  if (!vote) return false;
  clearVoteTimer(voteId);
  vote.status = 'cancelled';
  vote.error = `anulowane przez administratora <@${byAdminId}>`;
  await updateVoteMessage(client, vote, true);
  await postThreadNotice(client, vote, `🛑 Głosowanie #${vote.id} zostało anulowane przez administratora <@${byAdminId}>.`);
  await cleanupEvent(client, vote);
  archiveVote(vote);
  delete state.active[key];
  saveState();
  return true;
}

// ---------------------------------------------------------------------------
// Wykonawca akcji (re-walidacja w momencie wykonania)
// ---------------------------------------------------------------------------

async function executeAction(client, vote) {
  const guild = await client.guilds.fetch(vote.guildId);
  const me = await guild.members.fetchMe();
  const action = vote.action;

  const ensureRoleManageable = (role) => {
    if (!role) throw new Error('rola nie istnieje');
    if (isProtectedRole(role.id)) throw new Error('rola jest chroniona');
    if (role.managed) throw new Error('rola jest zarządzana przez integrację');
    if (role.id === guild.id) throw new Error('nie można modyfikować @everyone tą drogą');
    if (me.roles.highest.comparePositionTo(role) <= 0) throw new Error('bot nie ma wyższej roli od docelowej');
  };

  switch (action.kind) {
    case 'moderation': {
      if (action.op === 'unban') {
        await guild.members.unban(action.targetUserId, 'Decyzja demokratyczna').catch(e => { throw new Error(e.message); });
        return describeAction(action);
      }
      const member = await guild.members.fetch(action.targetUserId).catch(() => null);
      if (action.op === 'ban') {
        // ban może dotyczyć osoby spoza serwera; jeśli jest członkiem — sprawdź immunitet/hierarchię
        if (member && isImmuneMember(client, guild, member)) throw new Error('cel jest chroniony/administrator');
        if (member && !member.bannable) throw new Error('bot nie może zbanować tego członka (hierarchia)');
        await guild.members.ban(action.targetUserId, { reason: 'Decyzja demokratyczna' });
        return describeAction(action);
      }
      if (!member) throw new Error('użytkownik nie jest już na serwerze');
      if (isImmuneMember(client, guild, member)) throw new Error('cel jest chroniony/administrator');
      if (action.op === 'kick') {
        if (!member.kickable) throw new Error('bot nie może wyrzucić tego członka');
        await member.kick('Decyzja demokratyczna');
      } else if (action.op === 'timeout') {
        if (!member.moderatable) throw new Error('bot nie może wyciszyć tego członka');
        await member.timeout((action.punishSec || 300) * 1000, 'Decyzja demokratyczna');
      } else if (action.op === 'untimeout') {
        if (!member.moderatable) throw new Error('bot nie może zdjąć wyciszenia');
        await member.timeout(null, 'Decyzja demokratyczna');
      }
      return describeAction(action);
    }

    case 'role': {
      if (action.op === 'create') {
        const role = await guild.roles.create({ name: action.name, permissions: [], reason: 'Decyzja demokratyczna' });
        return `${describeAction(action)} → <@&${role.id}>`;
      }
      const role = await guild.roles.fetch(action.roleId).catch(() => null);
      ensureRoleManageable(role);
      if (action.op === 'delete') {
        await role.delete('Decyzja demokratyczna');
      } else if (action.op === 'assign' || action.op === 'unassign') {
        const member = await guild.members.fetch(action.targetUserId).catch(() => null);
        if (!member) throw new Error('użytkownik nie jest na serwerze');
        if (action.op === 'assign') await member.roles.add(role, 'Decyzja demokratyczna');
        else await member.roles.remove(role, 'Decyzja demokratyczna');
      } else if (action.op === 'permission') {
        const permName = resolvePermissionName(action.permission);
        if (!permName) throw new Error('nieznane uprawnienie');
        if (forbiddenSet().has(permName.toLowerCase())) throw new Error('uprawnienie zakazane do głosowania');
        const perms = new PermissionsBitField(role.permissions.bitfield);
        if (action.value) perms.add(PermissionFlagsBits[permName]);
        else perms.remove(PermissionFlagsBits[permName]);
        await role.setPermissions(perms, 'Decyzja demokratyczna');
      } else if (action.op === 'rename') {
        await role.setName(action.value, 'Decyzja demokratyczna');
      } else if (action.op === 'recolor') {
        await role.setColor(action.value, 'Decyzja demokratyczna');
      } else if (action.op === 'hoist') {
        await role.setHoist(!!action.value, 'Decyzja demokratyczna');
      } else if (action.op === 'mentionable') {
        await role.setMentionable(!!action.value, 'Decyzja demokratyczna');
      }
      return describeAction(action);
    }

    case 'channel': {
      if (action.op === 'create') {
        const typeMap = {
          text: ChannelType.GuildText,
          voice: ChannelType.GuildVoice,
          category: ChannelType.GuildCategory,
          announcement: ChannelType.GuildAnnouncement,
          forum: ChannelType.GuildForum,
          stage: ChannelType.GuildStageVoice
        };
        const ch = await guild.channels.create({ name: action.name, type: typeMap[action.channelType] ?? ChannelType.GuildText, reason: 'Decyzja demokratyczna' });
        return `${describeAction(action)} → <#${ch.id}>`;
      }
      const channel = await guild.channels.fetch(action.channelId).catch(() => null);
      if (!channel) throw new Error('kanał nie istnieje');
      if (action.op === 'delete') {
        await channel.delete('Decyzja demokratyczna');
      } else if (action.op === 'permission') {
        const permName = resolvePermissionName(action.permission);
        if (!permName) throw new Error('nieznane uprawnienie');
        if (forbiddenSet().has(permName.toLowerCase())) throw new Error('uprawnienie zakazane do głosowania');
        const val = action.permState === 'allow' ? true : (action.permState === 'deny' ? false : null);
        await channel.permissionOverwrites.edit(action.targetId, { [permName]: val }, { reason: 'Decyzja demokratyczna' });
      } else if (action.op === 'rename') {
        await channel.setName(action.value, 'Decyzja demokratyczna');
      } else if (action.op === 'topic') {
        await channel.setTopic(action.value, 'Decyzja demokratyczna');
      } else if (action.op === 'nsfw') {
        await channel.setNSFW(!!action.value, 'Decyzja demokratyczna');
      } else if (action.op === 'slowmode') {
        await channel.setRateLimitPerUser(clampInt(action.value, 0, 21600, 0), 'Decyzja demokratyczna');
      }
      return describeAction(action);
    }

    case 'server': {
      if (action.setting === 'name') await guild.setName(action.value, 'Decyzja demokratyczna');
      else if (action.setting === 'description') await guild.setDescription(action.value, 'Decyzja demokratyczna');
      else throw new Error('nieobsługiwane ustawienie serwera');
      return describeAction(action);
    }

    case 'asset': {
      if (action.assetType === 'emoji') {
        if (action.op === 'add') {
          if (!action.url) throw new Error('brak URL emoji');
          await guild.emojis.create({ attachment: action.url, name: action.name, reason: 'Decyzja demokratyczna' });
        } else {
          const id = action.id || guild.emojis.cache.find(e => e.name === action.name)?.id;
          if (!id) throw new Error('nie znaleziono emoji');
          await guild.emojis.delete(id, 'Decyzja demokratyczna');
        }
      } else {
        if (action.op === 'add') {
          if (!action.url) throw new Error('brak URL naklejki');
          await guild.stickers.create({ file: action.url, name: action.name, tags: action.name, reason: 'Decyzja demokratyczna' });
        } else {
          const id = action.id || guild.stickers.cache.find(s => s.name === action.name)?.id;
          if (!id) throw new Error('nie znaleziono naklejki');
          await guild.stickers.delete(id, 'Decyzja demokratyczna');
        }
      }
      return describeAction(action);
    }

    default:
      throw new Error('nieznana akcja');
  }
}

// ---------------------------------------------------------------------------
// Powiadomienia DM
// ---------------------------------------------------------------------------

async function notifySubscribers(client, vote) {
  const subs = (state.notify[vote.guildId] || []);
  if (!subs.length) return;
  const line =
    `🗳️ Nowe głosowanie **#${vote.id}** — ${vote.title}\n` +
    `${vote.description}\n` +
    `Kończy się <t:${Math.floor(vote.endsAt / 1000)}:R>. Zagłosuj w wątku na serwerze.`;
  for (const uid of subs) {
    try {
      const user = await client.users.fetch(uid).catch(() => null);
      if (user) await user.send(line).catch(() => {});
    } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Definicja komendy
// ---------------------------------------------------------------------------

const permHint = 'Uprawnienie (autouzupełnianie; Administrator jest zablokowany)';

const data = new SlashCommandBuilder()
  .setName('democracy')
  .setDescription('Demokracja bezpośrednia — głosuj o wszystko na serwerze')
  .setContexts(InteractionContextType.Guild)
  .addSubcommandGroup(g => g
    .setName('start')
    .setDescription('Rozpocznij nowe głosowanie')
    .addSubcommand(sc => sc
      .setName('mod')
      .setDescription('Moderacja: timeout / kick / ban / unban')
      .addStringOption(o => o.setName('op').setDescription('Akcja').setRequired(true).addChoices(
        { name: 'timeout', value: 'timeout' },
        { name: 'untimeout (zdejmij)', value: 'untimeout' },
        { name: 'kick', value: 'kick' },
        { name: 'ban', value: 'ban' },
        { name: 'unban', value: 'unban' }
      ))
      .addUserOption(o => o.setName('user').setDescription('Cel').setRequired(true))
      .addIntegerOption(o => o.setName('punish_minutes').setDescription('Długość timeoutu w minutach (1–40320)').setMinValue(1).setMaxValue(40320))
      .addStringOption(o => o.setName('vote_length').setDescription('Długość głosowania, np. 30m, 2h, 1d'))
      .addStringOption(o => o.setName('reason').setDescription('Uzasadnienie (do 250 znaków)').setMaxLength(250))
      .addIntegerOption(o => o.setName('ov_min_votes').setDescription('[admin] Nadpisz próg głosów').setMinValue(1)))
    .addSubcommand(sc => sc
      .setName('role')
      .setDescription('Role: utwórz/usuń/nadaj/odbierz/uprawnienie/nazwa/kolor/hoist/oznaczalność')
      .addStringOption(o => o.setName('op').setDescription('Akcja').setRequired(true).addChoices(
        { name: 'create (utwórz pustą)', value: 'create' },
        { name: 'delete (usuń)', value: 'delete' },
        { name: 'assign (nadaj userowi)', value: 'assign' },
        { name: 'unassign (odbierz)', value: 'unassign' },
        { name: 'permission (uprawnienie)', value: 'permission' },
        { name: 'rename (nazwa)', value: 'rename' },
        { name: 'recolor (kolor)', value: 'recolor' },
        { name: 'hoist (osobno)', value: 'hoist' },
        { name: 'mentionable (oznaczalna)', value: 'mentionable' }
      ))
      .addRoleOption(o => o.setName('role').setDescription('Rola docelowa'))
      .addUserOption(o => o.setName('user').setDescription('Użytkownik (assign/unassign)'))
      .addStringOption(o => o.setName('name').setDescription('Nazwa (create/rename) lub kolor hex (recolor)'))
      .addStringOption(o => o.setName('permission').setDescription(permHint).setAutocomplete(true))
      .addBooleanOption(o => o.setName('value').setDescription('Wartość true/false (permission/hoist/mentionable)'))
      .addStringOption(o => o.setName('vote_length').setDescription('Długość głosowania, np. 1h, 1d'))
      .addStringOption(o => o.setName('reason').setDescription('Uzasadnienie (do 250 znaków)').setMaxLength(250))
      .addIntegerOption(o => o.setName('ov_min_votes').setDescription('[admin] Nadpisz próg głosów').setMinValue(1)))
    .addSubcommand(sc => sc
      .setName('channel')
      .setDescription('Kanały: utwórz/usuń/uprawnienie/nazwa/temat/nsfw/slowmode')
      .addStringOption(o => o.setName('op').setDescription('Akcja').setRequired(true).addChoices(
        { name: 'create (utwórz)', value: 'create' },
        { name: 'delete (usuń)', value: 'delete' },
        { name: 'permission (uprawnienie)', value: 'permission' },
        { name: 'rename (nazwa)', value: 'rename' },
        { name: 'topic (temat)', value: 'topic' },
        { name: 'nsfw', value: 'nsfw' },
        { name: 'slowmode', value: 'slowmode' }
      ))
      .addChannelOption(o => o.setName('channel').setDescription('Kanał docelowy'))
      .addStringOption(o => o.setName('type').setDescription('Typ (create)').addChoices(
        { name: 'text', value: 'text' },
        { name: 'voice', value: 'voice' },
        { name: 'category', value: 'category' },
        { name: 'announcement', value: 'announcement' },
        { name: 'forum', value: 'forum' },
        { name: 'stage', value: 'stage' }
      ))
      .addRoleOption(o => o.setName('target_role').setDescription('Cel uprawnienia: rola'))
      .addUserOption(o => o.setName('target_user').setDescription('Cel uprawnienia: użytkownik'))
      .addStringOption(o => o.setName('permission').setDescription(permHint).setAutocomplete(true))
      .addStringOption(o => o.setName('perm_state').setDescription('Stan uprawnienia').addChoices(
        { name: 'allow (✔ true)', value: 'allow' },
        { name: 'deny (✘ false)', value: 'deny' },
        { name: 'neutral (brak/none)', value: 'neutral' }
      ))
      .addStringOption(o => o.setName('value').setDescription('Nazwa/temat/slowmode(s)/nsfw(true|false)'))
      .addStringOption(o => o.setName('vote_length').setDescription('Długość głosowania, np. 1h, 1d'))
      .addStringOption(o => o.setName('reason').setDescription('Uzasadnienie (do 250 znaków)').setMaxLength(250))
      .addIntegerOption(o => o.setName('ov_min_votes').setDescription('[admin] Nadpisz próg głosów').setMinValue(1)))
    .addSubcommand(sc => sc
      .setName('server')
      .setDescription('Ustawienia serwera (nazwa, opis)')
      .addStringOption(o => o.setName('setting').setDescription('Ustawienie').setRequired(true).addChoices(
        { name: 'name (nazwa)', value: 'name' },
        { name: 'description (opis)', value: 'description' }
      ))
      .addStringOption(o => o.setName('value').setDescription('Nowa wartość').setRequired(true))
      .addStringOption(o => o.setName('vote_length').setDescription('Długość głosowania, np. 1d'))
      .addStringOption(o => o.setName('reason').setDescription('Uzasadnienie (do 250 znaków)').setMaxLength(250))
      .addIntegerOption(o => o.setName('ov_min_votes').setDescription('[admin] Nadpisz próg głosów').setMinValue(1)))
    .addSubcommand(sc => sc
      .setName('asset')
      .setDescription('Emoji / naklejki: dodaj lub usuń')
      .addStringOption(o => o.setName('type').setDescription('Typ').setRequired(true).addChoices(
        { name: 'emoji', value: 'emoji' },
        { name: 'sticker (naklejka)', value: 'sticker' }
      ))
      .addStringOption(o => o.setName('op').setDescription('Akcja').setRequired(true).addChoices(
        { name: 'add (dodaj)', value: 'add' },
        { name: 'remove (usuń)', value: 'remove' }
      ))
      .addStringOption(o => o.setName('name').setDescription('Nazwa emoji/naklejki'))
      .addStringOption(o => o.setName('url').setDescription('URL obrazka (add)'))
      .addStringOption(o => o.setName('id').setDescription('ID do usunięcia (remove)'))
      .addStringOption(o => o.setName('vote_length').setDescription('Długość głosowania, np. 1h'))
      .addStringOption(o => o.setName('reason').setDescription('Uzasadnienie (do 250 znaków)').setMaxLength(250))
      .addIntegerOption(o => o.setName('ov_min_votes').setDescription('[admin] Nadpisz próg głosów').setMinValue(1))))
  .addSubcommand(sc => sc
    .setName('list')
    .setDescription('Lista aktywnych głosowań'))
  .addSubcommand(sc => sc
    .setName('info')
    .setDescription('Szczegóły głosowania (admin widzi kto jak głosował)')
    .addIntegerOption(o => o.setName('vote_id').setDescription('ID głosowania').setRequired(true).setAutocomplete(true)))
  .addSubcommand(sc => sc
    .setName('history')
    .setDescription('Historia zakończonych głosowań')
    .addIntegerOption(o => o.setName('limit').setDescription('Ile pozycji (1–20)').setMinValue(1).setMaxValue(20)))
  .addSubcommand(sc => sc
    .setName('stop')
    .setDescription('[admin] Zatrzymaj i usuń trwające głosowanie')
    .addIntegerOption(o => o.setName('vote_id').setDescription('ID głosowania').setRequired(true).setAutocomplete(true)))
  .addSubcommand(sc => sc
    .setName('notify')
    .setDescription('Włącz/wyłącz powiadomienia DM o nowych głosowaniach')
    .addStringOption(o => o.setName('state').setDescription('on / off').setRequired(true).addChoices(
      { name: 'on', value: 'on' },
      { name: 'off', value: 'off' }
    )))
  .addSubcommand(sc => sc
    .setName('config')
    .setDescription('[admin] Pokaż konfigurację modułu'));

// ---------------------------------------------------------------------------
// Obsługa komend
// ---------------------------------------------------------------------------

function ephemeral(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  // Po deferReply pierwsza odpowiedź musi iść przez editReply (inaczej zostaje "myślę…"),
  // kolejne przez followUp; bez defer — zwykłe reply.
  if (interaction.deferred && !interaction.replied) return interaction.editReply({ content });
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

async function handleStart(interaction, sub) {
  // Tworzenie głosowania robi kilka wywołań REST (wiadomość + wątek + event) —
  // to przekracza 3s okno tokenu, więc odraczamy odpowiedź od razu.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  const client = interaction.client;
  const bool = (n) => interaction.options.getBoolean(n);

  let category, action, title;

  if (sub === 'mod') {
    const op = interaction.options.getString('op');
    const user = interaction.options.getUser('user');
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (op !== 'unban' && op !== 'ban' && !member) return ephemeral(interaction, '❌ Ten użytkownik nie jest na serwerze.');
    if (member && isImmuneMember(client, guild, member) && (op === 'ban' || op === 'kick' || op === 'timeout')) {
      return ephemeral(interaction, '🛡️ Ten użytkownik jest chroniony (administrator / lista chronionych) i nie może być celem tego głosowania.');
    }
    const categoryMap = { timeout: 'timeout', untimeout: 'untimeout', kick: 'kick', ban: 'ban', unban: 'unban' };
    category = categoryMap[op];
    action = { kind: 'moderation', op, targetUserId: user.id };
    if (op === 'timeout') {
      const mins = interaction.options.getInteger('punish_minutes') || 10;
      action.punishSec = mins * 60;
    }
    title = describeAction(action);
  } else if (sub === 'role') {
    const op = interaction.options.getString('op');
    const role = interaction.options.getRole('role');
    const user = interaction.options.getUser('user');
    const name = interaction.options.getString('name');
    action = { kind: 'role', op };
    if (op === 'create') {
      if (!name) return ephemeral(interaction, '❌ Podaj `name` dla nowej roli.');
      category = 'role_create';
      action.name = name.slice(0, 100);
    } else {
      if (!role) return ephemeral(interaction, '❌ Wskaż rolę (`role`).');
      if (isProtectedRole(role.id)) return ephemeral(interaction, '🛡️ Ta rola jest chroniona.');
      if (role.id === guild.id) return ephemeral(interaction, '❌ Nie można głosować nad @everyone tą drogą.');
      action.roleId = role.id;
      if (op === 'delete') category = 'role_delete';
      else if (op === 'assign' || op === 'unassign') {
        if (!user) return ephemeral(interaction, '❌ Wskaż użytkownika (`user`).');
        category = 'role_assign';
        action.targetUserId = user.id;
      } else if (op === 'permission') {
        const permName = resolvePermissionName(interaction.options.getString('permission'));
        if (!permName) return ephemeral(interaction, '❌ Nieznane uprawnienie. Skorzystaj z autouzupełniania.');
        if (forbiddenSet().has(permName.toLowerCase())) return ephemeral(interaction, `🚫 Uprawnienia \`${permName}\` nie można głosować (zablokowane, np. Administrator).`);
        if (bool('value') == null) return ephemeral(interaction, '❌ Podaj `value` (true/false).');
        category = 'role_permission';
        action.permission = permName;
        action.value = bool('value');
      } else if (op === 'rename') {
        if (!name) return ephemeral(interaction, '❌ Podaj `name` (nowa nazwa).');
        category = 'role_setting'; action.value = name.slice(0, 100);
      } else if (op === 'recolor') {
        if (!name) return ephemeral(interaction, '❌ Podaj `name` jako kolor hex, np. #ff0000.');
        category = 'role_setting'; action.value = name;
      } else if (op === 'hoist' || op === 'mentionable') {
        if (bool('value') == null) return ephemeral(interaction, '❌ Podaj `value` (true/false).');
        category = 'role_setting'; action.value = bool('value');
      }
    }
    title = describeAction(action);
  } else if (sub === 'channel') {
    const op = interaction.options.getString('op');
    const channel = interaction.options.getChannel('channel');
    const value = interaction.options.getString('value');
    action = { kind: 'channel', op };
    if (op === 'create') {
      if (!value) return ephemeral(interaction, '❌ Podaj `value` jako nazwę nowego kanału.');
      category = 'channel_create';
      action.name = value.slice(0, 100);
      action.channelType = interaction.options.getString('type') || 'text';
    } else {
      if (!channel) return ephemeral(interaction, '❌ Wskaż kanał (`channel`).');
      action.channelId = channel.id;
      if (op === 'delete') category = 'channel_delete';
      else if (op === 'permission') {
        const tRole = interaction.options.getRole('target_role');
        const tUser = interaction.options.getUser('target_user');
        if (!tRole && !tUser) return ephemeral(interaction, '❌ Wskaż `target_role` albo `target_user`.');
        if (tRole && isProtectedRole(tRole.id)) return ephemeral(interaction, '🛡️ Ta rola jest chroniona.');
        const permName = resolvePermissionName(interaction.options.getString('permission'));
        if (!permName) return ephemeral(interaction, '❌ Nieznane uprawnienie. Skorzystaj z autouzupełniania.');
        if (forbiddenSet().has(permName.toLowerCase())) return ephemeral(interaction, `🚫 Uprawnienia \`${permName}\` nie można głosować.`);
        const permState = interaction.options.getString('perm_state') || 'allow';
        category = 'channel_permission';
        action.permission = permName;
        action.permState = permState;
        action.targetId = tRole ? tRole.id : tUser.id;
        action.targetMention = tRole ? `<@&${tRole.id}>` : `<@${tUser.id}>`;
      } else if (op === 'rename') {
        if (!value) return ephemeral(interaction, '❌ Podaj `value` (nowa nazwa).');
        category = 'channel_setting'; action.value = value.slice(0, 100);
      } else if (op === 'topic') {
        category = 'channel_setting'; action.value = (value || '').slice(0, 1024);
      } else if (op === 'nsfw') {
        category = 'channel_setting'; action.value = /^(true|1|tak|yes|on)$/i.test(value || '');
      } else if (op === 'slowmode') {
        category = 'channel_setting'; action.value = clampInt(value, 0, 21600, 0);
      }
    }
    title = describeAction(action);
  } else if (sub === 'server') {
    const setting = interaction.options.getString('setting');
    const value = interaction.options.getString('value');
    category = 'server';
    action = { kind: 'server', setting, value: value.slice(0, 1000) };
    title = describeAction(action);
  } else if (sub === 'asset') {
    const assetType = interaction.options.getString('type');
    const op = interaction.options.getString('op');
    const name = interaction.options.getString('name');
    const url = interaction.options.getString('url');
    const id = interaction.options.getString('id');
    category = assetType === 'sticker' ? 'sticker' : 'emoji';
    action = { kind: 'asset', assetType, op, name: name ? name.slice(0, 32) : null, url, id };
    if (op === 'add' && (!name || !url)) return ephemeral(interaction, '❌ Do dodania podaj `name` oraz `url`.');
    if (op === 'remove' && !id && !name) return ephemeral(interaction, '❌ Do usunięcia podaj `id` albo `name`.');
    title = describeAction(action);
  } else {
    return ephemeral(interaction, '❌ Nieznana kategoria.');
  }

  try {
    const { vote, thread } = await createVote(interaction, category, action, title);
    const where = thread ? `<#${thread.id}>` : 'kanale głosowań';
    return ephemeral(interaction,
      `✅ Utworzono głosowanie **#${vote.id}** w ${where}.\n` +
      `Kategoria: \`${category}\` • próg: **${vote.minVotes}** głosów • czas: **${formatDuration(vote.durationSec)}**` +
      (vote.adminStarted ? '\n👑 Uruchomione jako admin (limity mogą być nadpisane).' : ''));
  } catch (e) {
    console.error(`[${MODULE_NAME}] createVote:`, e);
    return ephemeral(interaction, `❌ Nie udało się utworzyć głosowania: ${e.message}`);
  }
}

async function execute(interaction) {
  if (typeof interaction.client.isModuleEnabled === 'function' && !interaction.client.isModuleEnabled(MODULE_NAME)) {
    return ephemeral(interaction, 'Moduł democracy jest wyłączony.');
  }
  if (!config.enabled) return ephemeral(interaction, 'Moduł democracy jest wyłączony w konfiguracji.');
  if (!interaction.guild) return ephemeral(interaction, 'Ta komenda działa tylko na serwerze.');

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'start') return handleStart(interaction, sub);

  const client = interaction.client;

  if (sub === 'list') {
    const votes = Object.values(state.active).filter(v => v.guildId === interaction.guild.id);
    if (!votes.length) return ephemeral(interaction, 'Brak aktywnych głosowań.');
    const lines = votes.sort((a, b) => a.id - b.id).map(v => {
      const t = tally(v);
      return `**#${v.id}** \`${v.category}\` — ${v.title}\n   ${t.for}✅ / ${t.against}❌ / ${t.abstain}🤝 • kworum ${t.total}/${v.minVotes} • kończy <t:${Math.floor(v.endsAt / 1000)}:R>`;
    });
    return ephemeral(interaction, lines.join('\n').slice(0, 1900));
  }

  if (sub === 'info') {
    const id = interaction.options.getInteger('vote_id');
    const vote = state.active[String(id)] || state.history.find(h => h.id === id && h.guildId === interaction.guild.id);
    if (!vote || (vote.guildId && vote.guildId !== interaction.guild.id)) return ephemeral(interaction, `Nie znaleziono głosowania #${id}.`);
    const t = vote.tally || tally(vote);
    let text =
      `🗳️ **Głosowanie #${vote.id}** — ${vote.title}\n` +
      `Kategoria: \`${vote.category}\`\n` +
      `Opis: ${vote.description}\n` +
      `Wnioskodawca: <@${vote.starterId}>\n` +
      (vote.reason ? `Uzasadnienie: ${vote.reason}\n` : '') +
      `Wynik: ${statusLabel(vote.result || vote.status)}\n` +
      `Głosy: ${t.for}✅ / ${t.against}❌ / ${t.abstain}🤝 (kworum ${t.total}/${vote.minVotes})\n`;
    if (isDemocracyAdmin(interaction)) {
      const entries = Object.entries(vote.votes || {});
      if (entries.length) {
        const detail = entries.map(([uid, ch]) => `<@${uid}>: ${ch === 'for' ? '✅' : ch === 'against' ? '❌' : '🤝'}`).join(', ');
        text += `\n👑 **Szczegóły (admin):**\n${detail}`;
      }
    } else {
      text += '\n_Kto jak głosował widzi tylko administrator._';
    }
    return ephemeral(interaction, text.slice(0, 1900));
  }

  if (sub === 'history') {
    const limit = interaction.options.getInteger('limit') || 10;
    const items = state.history.filter(h => h.guildId === interaction.guild.id).slice(0, limit);
    if (!items.length) return ephemeral(interaction, 'Historia jest pusta.');
    const lines = items.map(h => {
      const t = h.tally || { for: 0, against: 0, abstain: 0, total: 0 };
      return `**#${h.id}** ${statusLabel(h.result)} — ${h.title}\n   ${t.for}✅/${t.against}❌/${t.abstain}🤝 • <t:${Math.floor(h.endedAt / 1000)}:f>`;
    });
    return ephemeral(interaction, lines.join('\n').slice(0, 1900));
  }

  if (sub === 'stop') {
    if (!isDemocracyAdmin(interaction)) return ephemeral(interaction, '🚫 Tylko administrator może zatrzymać głosowanie.');
    const id = interaction.options.getInteger('vote_id');
    const vote = state.active[String(id)];
    if (!vote || vote.guildId !== interaction.guild.id) return ephemeral(interaction, `Nie znaleziono aktywnego głosowania #${id}.`);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // cancelVote robi kilka wywołań REST
    await cancelVote(client, id, interaction.user.id);
    return ephemeral(interaction, `🛑 Głosowanie #${id} zostało anulowane i usunięte.`);
  }

  if (sub === 'notify') {
    const on = interaction.options.getString('state') === 'on';
    const gid = interaction.guild.id;
    if (!state.notify[gid]) state.notify[gid] = [];
    const arr = state.notify[gid];
    const idx = arr.indexOf(interaction.user.id);
    if (on && idx === -1) arr.push(interaction.user.id);
    if (!on && idx !== -1) arr.splice(idx, 1);
    saveState();
    return ephemeral(interaction, on
      ? '🔔 Będziesz dostawać DM o każdym nowym głosowaniu. (Bot musi móc wysłać Ci wiadomość prywatną.)'
      : '🔕 Wyłączono powiadomienia DM o nowych głosowaniach.');
  }

  if (sub === 'config') {
    if (!isDemocracyAdmin(interaction)) return ephemeral(interaction, '🚫 Tylko administrator.');
    const cats = Object.entries(config.categories || {}).map(([k, v]) =>
      `\`${k}\`: min ${v.minVotes} głosów, czas ${formatDuration(v.minDurationSec)}–${formatDuration(v.maxDurationSec)}`).join('\n');
    const text =
      `⚙️ **Konfiguracja democracy**\n` +
      `Włączony: ${config.enabled}\n` +
      `Kanał głosowań: ${config.voteChannelId ? `<#${config.voteChannelId}>` : '(kanał komendy)'}\n` +
      `Eventy: ${config.createEvents} • passRatio: ${config.passRatio} • activeMemberRatio: ${config.activeMemberRatio}\n` +
      `Zakazane uprawnienia: ${(config.forbiddenPermissions || []).join(', ') || '—'}\n` +
      `Chronieni: ${(config.protected?.userIds || []).length} userów / ${(config.protected?.roleIds || []).length} ról\n\n` +
      `**Kategorie:**\n${cats}`;
    return ephemeral(interaction, text.slice(0, 1900));
  }

  return ephemeral(interaction, 'Nieznana podkomenda.');
}

// ---------------------------------------------------------------------------
// Autocomplete (uprawnienia + ID głosowań)
// ---------------------------------------------------------------------------

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'permission') {
    const q = String(focused.value || '').toLowerCase();
    const list = votablePermissions()
      .filter(p => p.toLowerCase().includes(q))
      .slice(0, 25)
      .map(p => ({ name: p, value: p }));
    return interaction.respond(list);
  }
  if (focused.name === 'vote_id') {
    const votes = Object.values(state.active).filter(v => v.guildId === interaction.guild?.id);
    const q = String(focused.value || '');
    const list = votes
      .filter(v => String(v.id).includes(q) || v.title.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 25)
      .map(v => ({ name: `#${v.id} — ${v.title}`.slice(0, 100), value: v.id }));
    return interaction.respond(list);
  }
  return interaction.respond([]);
}

// ---------------------------------------------------------------------------
// Obsługa przycisków głosowania (globalny listener) + reschedule timerów
// ---------------------------------------------------------------------------

function moduleActive(client) {
  if (typeof client.isModuleEnabled === 'function' && !client.isModuleEnabled(MODULE_NAME)) return false;
  return config.enabled;
}

async function onButton(interaction) {
  if (!interaction.isButton?.()) return;
  if (!interaction.customId.startsWith('dem:')) return;

  const [, idStr, choice] = interaction.customId.split(':');
  const vote = state.active[idStr];
  if (!vote) {
    return interaction.reply({ content: 'To głosowanie już się zakończyło.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (!moduleActive(interaction.client)) {
    return interaction.reply({ content: 'Moduł democracy jest wyłączony.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (!['for', 'against', 'abstain'].includes(choice)) return;

  const prev = vote.votes[interaction.user.id];
  vote.votes[interaction.user.id] = choice;
  saveState();

  const label = choice === 'for' ? 'ZA ✅' : choice === 'against' ? 'PRZECIW ❌' : 'WSTRZYMUJĘ SIĘ 🤝';
  await interaction.reply({
    content: prev && prev !== choice ? `Zmieniono głos na **${label}**. (Twój głos jest tajny.)` : `Zapisano głos: **${label}**. (Twój głos jest tajny.)`,
    flags: MessageFlags.Ephemeral
  }).catch(() => {});

  // Odśwież embed (zliczenia zbiorcze, bez tożsamości)
  updateVoteMessage(interaction.client, vote).catch(() => {});
}

function init(client) {
  // reload: usuń poprzedni listener i timery
  const previous = client[RUNTIME_KEY];
  if (previous) {
    client.off('interactionCreate', previous.onButton);
    for (const h of previous.timers?.values?.() || []) clearTimeout(h);
  }
  for (const h of timers.values()) clearTimeout(h);
  timers.clear();

  // odśwież config/state z dysku (na wypadek edycji plików)
  config = loadConfig();
  state = loadState();

  client.on('interactionCreate', onButton);
  client[RUNTIME_KEY] = { onButton, timers };

  // reschedule aktywnych głosowań (przeżywają restart / reload).
  // init() bywa wołane przed client.login(); finalizacja "od razu" (deadline minął w czasie
  // przestoju) wymaga gotowego klienta, więc gatujemy pętlę na clientReady.
  const active = Object.values(state.active);
  const rescheduleAll = () => {
    for (const vote of Object.values(state.active)) {
      if (vote.status === 'active') scheduleFinalize(client, vote);
    }
  };
  if (client.isReady()) rescheduleAll();
  else client.once('clientReady', rescheduleAll);
  console.log(`[${MODULE_NAME}] Moduł zainicjalizowany (aktywne głosowania: ${active.length}, kanał: ${config.voteChannelId || 'kanał komendy'})`);
}

module.exports = { data, execute, autocomplete, init };
