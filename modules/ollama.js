const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { customId, parseCustomId, showModal, buttons } = require('../lib/interactions');

const MODULE = 'ollama';
// messageId -> the prompt/ephemeral behind a reply, so 🔄 Regeneruj can re-ask
// without a slash-option round trip. Small and short-lived on purpose.
const askCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, e] of askCache) if (e.expiresAt < now) askCache.delete(id);
}, 60_000).unref();

function askRow() {
  return buttons([
    { id: customId(MODULE, 'regen'), label: 'Regeneruj', style: 'secondary', emoji: '🔄' },
    { id: customId(MODULE, 'clearhist'), label: 'Wyczyść historię kanału', style: 'danger', emoji: '🗑️' }
  ]);
}

/** Primary config — ALWAYS modules/../config/ollama.json (never cwd-relative). */
const CONFIG_FILENAME = 'ollama.json';
const CONFIG_PATH = path.resolve(__dirname, '..', 'config', CONFIG_FILENAME);
const DISCORD_HARD_LIMIT = 2000;
const MODULE_NAME = 'ollama';

/**
 * Last snapshot loaded from disk (deep-cloned on every successful read).
 * NEVER mutate this in place from call sites — always treat as read-only.
 * Reload / init / getCfg re-read the file from disk when required.
 */
let cfgSnapshot = null;
/** mtimeMs + size of last successful disk read (for optional short-circuit) */
let cfgDiskSig = null;

/** conversation history: key -> { messages: [{role, content, at}], updatedAt } */
const historyStore = new Map();

/** userId -> last request timestamp */
const cooldowns = new Map();

/** channel:user keys currently generating */
const inFlight = new Set();

/**
 * Neutral defaults ONLY used to:
 *  1) create a missing ollama.json once
 *  2) fill keys omitted from the file
 * They are NOT the live runtime source of truth — ollama.json is.
 */
function defaultConfig() {
  return {
    enabled: true,
    server: {
      baseUrl: 'http://127.0.0.1:11434',
      host: '0.0.0.0:11434',
      timeoutMs: 0,
      api: 'chat',
      keepAlive: '2m',
      loadTimeout: -1,
      think: false,
      env: {
        OLLAMA_HOME: '/run/media/silverx/AI/OLLAMA',
        OLLAMA_MODELS: '/run/media/silverx/AI/OLLAMA/models',
        OLLAMA_HOST: '0.0.0.0:11434',
        OLLAMA_MAX_LOADED_MODELS: 1,
        OLLAMA_KEEP_ALIVE: '2m',
        OLLAMA_NUM_PARALLEL: 0,
        OLLAMA_FLASH_ATTENTION: 1,
        OLLAMA_KV_CACHE_TYPE: 'q8_0',
        OLLAMA_CONTEXT_LENGTH: 8192,
        OLLAMA_MAX_QUEUE: 256,
        OLLAMA_GPU_OVERHEAD: 2048,
        OLLAMA_SCHED_SPREAD: true,
        OLLAMA_DEBUG: 'INFO',
        OLLAMA_DEBUG_LOG_REQUESTS: true,
        OLLAMA_NO_CLOUD: 1,
        OLLAMA_LOAD_TIMEOUT: -1,
        OLLAMA_MULTIUSER_CACHE: true
      }
    },
    model: 'llama3.2',
    systemPrompt:
      'You are a helpful AI assistant running as a Discord bot. Prefer concise Discord-friendly replies. Never reveal internal reasoning — output only the final reply.',
    triggers: {
      onMention: true,
      onReplyToBot: true,
      requireGuild: false,
      ignoreBots: true,
      ignoreSelf: true,
      allowedChannels: [],
      blockedChannels: [],
      allowedGuilds: [],
      blockedGuilds: [],
      allowedUsers: [],
      blockedUsers: []
    },
    history: {
      enabled: true,
      maxMessages: 12,
      scope: 'channel',
      includeUsernames: true,
      ttlMinutes: 60,
      clearOnRestart: true
    },
    inference: {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      num_ctx: 8192,
      num_predict: 512,
      repeat_penalty: 1.1,
      seed: null,
      stop: [],
      mirostat: 0,
      mirostat_tau: 5.0,
      mirostat_eta: 0.1,
      num_gpu: null,
      num_thread: null
    },
    response: {
      maxCharsPerMessage: 2000,
      maxTotalChars: 8000,
      preferShort: true,
      shortReplyHint:
        'Keep this reply short (ideally under ~500 characters) unless more detail is requested. Output only the final answer.',
      splitStrategy: 'paragraph',
      showTyping: true,
      stripThinking: true,
      allowedMentions: { parse: [], repliedUser: true },
      prefix: '',
      suffix: '',
      thinkingMessage: null,
      errorMessage:
        "Sorry, I couldn't generate a response right now. The Ollama server may be unreachable or the model may be busy.",
      emptyPromptMessage: 'Mention me with a question, or reply to one of my messages.'
    },
    rateLimit: {
      enabled: true,
      cooldownMs: 2500,
      perUser: true,
      busyMessage: "I'm still working on your previous message — try again in a moment."
    }
  };
}

function configPath() {
  return CONFIG_PATH;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deep-merge where `file` wins for every key present
 * (including null / empty string / false / []). Missing keys keep defaults.
 */
function mergeFileOverDefaults(defaults, file) {
  if (file === null || file === undefined) return deepClone(defaults);
  if (Array.isArray(file)) return file.slice();
  if (typeof file !== 'object') return file;
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
    return deepClone(file);
  }

  const out = deepClone(defaults);
  for (const [key, value] of Object.entries(file)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof out[key] === 'object' &&
      out[key] !== null &&
      !Array.isArray(out[key])
    ) {
      out[key] = mergeFileOverDefaults(out[key], value);
    } else {
      out[key] = Array.isArray(value) ? value.slice() : value;
    }
  }
  return out;
}

/** Strip internal bookkeeping keys before writing JSON back to disk. */
function toDiskShape(config) {
  const clone = deepClone(config || {});
  delete clone._configPath;
  delete clone._loadedFromFile;
  delete clone._loadedAt;
  delete clone._loadError;
  delete clone._mtimeMs;
  delete clone._size;
  delete clone._rawHash;
  return clone;
}

function diskSignature(stat) {
  return `${stat.mtimeMs}:${stat.size}`;
}

function simpleHash(text) {
  // Fast non-crypto fingerprint so logs prove which file bytes we loaded
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

/**
 * STRICT disk load of config/ollama.json.
 * Always readFileSync's the file (no trusting in-memory settings as source of truth).
 * Verbose log on init / slash-reload / save, or when file signature changes.
 */
function loadConfigFromDisk({ force = false, reason = 'get' } = {}) {
  const filePath = configPath();
  const defaults = defaultConfig();
  // force is reserved for call-site clarity; we always re-read below
  void force;

  try {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const seed = defaultConfig();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), 'utf8');
      console.log(`[ollama] Created missing config file: ${filePath}`);
    }

    const st = fs.statSync(filePath);
    const sig = diskSignature(st);

    // ALWAYS read fresh bytes from disk — never return a previously mutated object
    const rawText = fs.readFileSync(filePath, 'utf8');
    const fileCfg = JSON.parse(rawText);
    if (!fileCfg || typeof fileCfg !== 'object' || Array.isArray(fileCfg)) {
      throw new Error('config root must be a JSON object');
    }

    // File is authoritative; defaults only fill keys the JSON omits
    const merged = mergeFileOverDefaults(defaults, fileCfg);
    merged._configPath = filePath;
    merged._loadedFromFile = true;
    merged._loadedAt = new Date().toISOString();
    merged._mtimeMs = st.mtimeMs;
    merged._size = st.size;
    merged._rawHash = simpleHash(rawText);

    const changed = cfgDiskSig !== sig || !cfgSnapshot;
    const verbose =
      reason === 'init' ||
      reason === 'slash-reload' ||
      reason === 'reload' ||
      reason === 'save' ||
      changed;

    cfgSnapshot = merged;
    cfgDiskSig = sig;

    if (verbose) {
      console.log(
        `[ollama] Config loaded from disk (${reason})\n` +
          `         path=${filePath}\n` +
          `         mtime=${new Date(st.mtimeMs).toISOString()} size=${st.size} hash=${merged._rawHash}\n` +
          `         model=${merged.model}\n` +
          `         server=${merged.server?.baseUrl} think=${merged.server?.think} keepAlive=${merged.server?.keepAlive}\n` +
          `         num_ctx=${merged.inference?.num_ctx} num_predict=${merged.inference?.num_predict}\n` +
          `         systemPrompt=${JSON.stringify(String(merged.systemPrompt || '').slice(0, 80))}`
      );
    }

    return deepClone(cfgSnapshot);
  } catch (e) {
    console.error(`[ollama] FAILED to load ${filePath}: ${e.message}`);
    // Do not silently pretend defaults are the file — flag clearly
    const fallback = {
      ...defaults,
      _configPath: filePath,
      _loadedFromFile: false,
      _loadedAt: new Date().toISOString(),
      _loadError: e.message
    };
    cfgSnapshot = fallback;
    cfgDiskSig = null;
    return deepClone(cfgSnapshot);
  }
}

/** Drop in-memory snapshot and force next load to hit the filesystem. */
function invalidateConfigCache() {
  cfgSnapshot = null;
  cfgDiskSig = null;
}

/**
 * Public: strict reload used by init, /ollama reload, and after save.
 * Always re-reads ollama.json from disk.
 */
function reloadConfigFromDisk(reason = 'reload') {
  invalidateConfigCache();
  return loadConfigFromDisk({ force: true, reason });
}

/** Persist config to ollama.json then strictly re-read that file back into memory. */
function saveConfig(next) {
  const filePath = configPath();
  const disk = toDiskShape(next);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(disk, null, 2), 'utf8');
  // Never trust the in-memory object we just wrote — re-read file bytes
  return reloadConfigFromDisk('save');
}

/**
 * Live config accessor used by inference / handlers.
 * ALWAYS re-reads ollama.json from disk (no stale in-memory settings).
 * Returns a deep clone so callers cannot poison the module snapshot.
 */
function getCfg() {
  return loadConfigFromDisk({ force: true, reason: 'get' });
}

function historyKey(message, scope) {
  const channelId = message.channelId || message.channel?.id;
  const guildId = message.guildId || 'dm';
  const userId = message.author?.id;
  switch (scope) {
    case 'user':
      return `user:${userId}`;
    case 'channel-user':
      return `cu:${channelId}:${userId}`;
    case 'guild-user':
      return `gu:${guildId}:${userId}`;
    case 'channel':
    default:
      return `ch:${channelId}`;
  }
}

function pruneHistory(key) {
  const c = getCfg().history || {};
  const entry = historyStore.get(key);
  if (!entry) return;

  const ttlMs = (c.ttlMinutes ?? 60) * 60 * 1000;
  if (ttlMs > 0 && Date.now() - entry.updatedAt > ttlMs) {
    historyStore.delete(key);
    return;
  }

  const max = Math.max(0, c.maxMessages ?? 12);
  if (entry.messages.length > max) {
    entry.messages = entry.messages.slice(-max);
  }
}

function pushHistory(key, role, content) {
  const c = getCfg().history || {};
  if (!c.enabled) return;

  let entry = historyStore.get(key);
  if (!entry) {
    entry = { messages: [], updatedAt: Date.now() };
    historyStore.set(key, entry);
  }
  entry.messages.push({ role, content, at: Date.now() });
  entry.updatedAt = Date.now();
  pruneHistory(key);
}

function getHistoryMessages(key) {
  const c = getCfg().history || {};
  if (!c.enabled) return [];
  pruneHistory(key);
  const entry = historyStore.get(key);
  if (!entry) return [];
  return entry.messages.map(m => ({ role: m.role, content: m.content }));
}

function clearHistory(filterKey = null) {
  if (!filterKey) {
    historyStore.clear();
    return 0;
  }
  if (historyStore.has(filterKey)) {
    historyStore.delete(filterKey);
    return 1;
  }
  // prefix clear e.g. ch:123
  let n = 0;
  for (const k of [...historyStore.keys()]) {
    if (k === filterKey || k.startsWith(filterKey)) {
      historyStore.delete(k);
      n++;
    }
  }
  return n;
}

function stripBotMentions(content, client) {
  if (!content) return '';
  const id = client.user?.id;
  if (!id) return content.trim();
  return content
    .replace(new RegExp(`<@!?${id}>`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isChannelAllowed(message) {
  const t = getCfg().triggers || {};
  const ch = message.channelId;
  const guild = message.guildId;
  const user = message.author?.id;

  if (t.requireGuild && !message.guild) return false;

  if (Array.isArray(t.allowedChannels) && t.allowedChannels.length && !t.allowedChannels.includes(ch)) return false;
  if (Array.isArray(t.blockedChannels) && t.blockedChannels.includes(ch)) return false;

  if (guild) {
    if (Array.isArray(t.allowedGuilds) && t.allowedGuilds.length && !t.allowedGuilds.includes(guild)) return false;
    if (Array.isArray(t.blockedGuilds) && t.blockedGuilds.includes(guild)) return false;
  }

  if (Array.isArray(t.allowedUsers) && t.allowedUsers.length && !t.allowedUsers.includes(user)) return false;
  if (Array.isArray(t.blockedUsers) && t.blockedUsers.includes(user)) return false;

  return true;
}

async function shouldTrigger(message, client) {
  const t = getCfg().triggers || {};

  if (t.ignoreSelf !== false && message.author?.id === client.user?.id) return { trigger: false };
  if (t.ignoreBots !== false && message.author?.bot) return { trigger: false };
  if (!isChannelAllowed(message)) return { trigger: false };

  const mentioned =
    t.onMention !== false &&
    (message.mentions?.has?.(client.user) ||
      (client.user && message.content?.includes(`<@${client.user.id}>`)) ||
      (client.user && message.content?.includes(`<@!${client.user.id}>`)));

  let replyToBot = false;
  if (t.onReplyToBot !== false && message.reference?.messageId) {
    try {
      const ref =
        message.channel.messages.cache.get(message.reference.messageId) ||
        (await message.channel.messages.fetch(message.reference.messageId).catch(() => null));
      if (ref && ref.author?.id === client.user?.id) {
        replyToBot = true;
      }
    } catch {
      // ignore fetch errors
    }
  }

  if (!mentioned && !replyToBot) return { trigger: false };
  return { trigger: true, mentioned, replyToBot };
}

function buildInferenceOptions() {
  const inf = getCfg().inference || {};
  const options = {};
  const keys = [
    'temperature',
    'top_p',
    'top_k',
    'num_ctx',
    'num_predict',
    'repeat_penalty',
    'seed',
    'stop',
    'mirostat',
    'mirostat_tau',
    'mirostat_eta',
    'num_gpu',
    'num_thread'
  ];
  for (const k of keys) {
    if (inf[k] === null || inf[k] === undefined) continue;
    if (Array.isArray(inf[k]) && inf[k].length === 0) continue;
    options[k] = inf[k];
  }
  return options;
}

function buildSystemContent() {
  const c = getCfg();
  const parts = [];
  if (c.systemPrompt) parts.push(String(c.systemPrompt).trim());
  if (c.response?.preferShort && c.response?.shortReplyHint) {
    parts.push(String(c.response.shortReplyHint).trim());
  }
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Strip model chain-of-thought / think blocks so Discord only gets the final reply.
 * Handles common Qwen/DeepSeek/OpenAI-style wrappers and leftover open tags.
 */
function stripThinking(text) {
  if (!text) return '';
  let out = String(text);

  // Paired XML-ish blocks
  out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
  out = out.replace(/<thought\b[^>]*>[\s\S]*?<\/thought>/gi, '');
  out = out.replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '');
  out = out.replace(/<reflection\b[^>]*>[\s\S]*?<\/reflection>/gi, '');

  // Markdown fenced "thinking" sections
  out = out.replace(/```(?:thinking|thought|reasoning|analysis)[\s\S]*?```/gi, '');

  // If model dumped an unclosed think block at the start, drop through the closer if any,
  // otherwise drop a leading open tag line.
  if (/<\/think>/i.test(out) && !/<think\b/i.test(out)) {
    out = out.replace(/^[\s\S]*?<\/think>/i, '');
  }
  out = out.replace(/^\s*<think\b[^>]*>[\s\S]*$/i, '');

  // Common "Thinking:" preambles (single short lead-in only)
  out = out.replace(/^\s*(?:thinking|reasoning|analysis)\s*:\s*/i, '');

  return out.replace(/^\s+|\s+$/g, '').replace(/\n{3,}/g, '\n\n');
}

function finalizeModelReply(raw) {
  const c = getCfg();
  let text = raw == null ? '' : String(raw);
  if (c.response?.stripThinking !== false) {
    text = stripThinking(text);
  }
  return text.trim();
}

/**
 * Pull the user-visible assistant text from an Ollama /api/chat or /api/generate body.
 *
 * Qwen3.5 (and similar) with thinking enabled often return:
 *   { message: { role, content: "", thinking: "..." } }
 * so reading only `content` yields "" even on HTTP 200.
 */
function extractAssistantText(data) {
  if (!data || typeof data !== 'object') return '';

  const msg = data.message && typeof data.message === 'object' ? data.message : null;
  const content = msg && msg.content != null ? String(msg.content) : '';
  const thinking = msg && msg.thinking != null ? String(msg.thinking) : '';
  const topResponse = data.response != null ? String(data.response) : '';

  // Preferred: normal assistant content
  if (content.trim()) return content;

  // generate API
  if (topResponse.trim()) return topResponse;

  // Fallback: some templates only fill thinking. Prefer text after the last
  // think-closer; otherwise last non-empty paragraph; otherwise whole thinking.
  if (thinking.trim()) {
    const afterClose = thinking.split(/<\/think>/i).pop();
    if (afterClose && afterClose.trim() && afterClose.trim() !== thinking.trim()) {
      return afterClose;
    }
    // "Final answer:" / "Answer:" style tails
    const finalMatch = thinking.match(
      /(?:final\s+answer|final\s+response|answer|reply)\s*[:：]\s*([\s\S]+)$/i
    );
    if (finalMatch && finalMatch[1].trim()) return finalMatch[1];

    const paras = thinking
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean);
    if (paras.length) return paras[paras.length - 1];
    return thinking;
  }

  return '';
}

function resolveRequestTimeoutMs(server) {
  // timeoutMs: 0 / null / negative => no AbortController timeout (long gens / OLLAMA_LOAD_TIMEOUT=-1)
  const t = server?.timeoutMs;
  if (t === 0 || t === null || t === undefined || t === -1) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function resolveKeepAlive(server) {
  // Prefer explicit keepAlive, else env mirror from ollama-env.sh
  if (server?.keepAlive != null && server.keepAlive !== '') return server.keepAlive;
  if (server?.env?.OLLAMA_KEEP_ALIVE != null) return server.env.OLLAMA_KEEP_ALIVE;
  return '2m';
}

/**
 * Call Ollama /api/chat (preferred) or /api/generate.
 * @returns {Promise<string>} final reply only (thinking stripped when configured)
 */
async function callOllama(userPrompt, historyMessages = []) {
  // Always pull from live ollama.json (mtime-aware)
  const c = getCfg();
  if (c.enabled === false) {
    throw new Error('Ollama module is disabled in config/ollama.json (enabled: false)');
  }

  const baseUrl = String(c.server?.baseUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('config/ollama.json: server.baseUrl is missing or empty');
  }

  const model = c.model != null ? String(c.model).trim() : '';
  if (!model) {
    throw new Error('config/ollama.json: model is missing or empty');
  }

  const timeoutMs = resolveRequestTimeoutMs(c.server);
  const keepAlive = resolveKeepAlive(c.server);
  const options = buildInferenceOptions();
  const system = buildSystemContent();
  const api = String(c.server?.api || 'chat').toLowerCase();
  // Default false: thinking models otherwise fill message.thinking and leave content empty
  const think = c.server?.think === true;

  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    if (api === 'generate') {
      // Flatten history into a single prompt for /api/generate
      const lines = [];
      if (system) lines.push(`System: ${system}`);
      for (const m of historyMessages) {
        const label = m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User';
        lines.push(`${label}: ${m.content}`);
      }
      lines.push(`User: ${userPrompt}`);
      lines.push('Assistant:');

      const body = {
        model,
        prompt: lines.join('\n'),
        system: system || undefined,
        stream: false,
        keep_alive: keepAlive,
        think,
        options
      };

      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama generate HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      const raw = extractAssistantText(data);
      const final = finalizeModelReply(raw);
      if (!final) {
        console.warn(
          '[ollama] Empty assistant text after parse (generate). message keys:',
          data.message ? Object.keys(data.message) : '(none)',
          'contentLen=',
          data.message?.content != null ? String(data.message.content).length : 0,
          'thinkingLen=',
          data.message?.thinking != null ? String(data.message.thinking).length : 0
        );
      }
      return final;
    }

    // Default: /api/chat
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const m of historyMessages) {
      if (m.role === 'system') continue; // already injected
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: userPrompt });

    const body = {
      model,
      messages,
      stream: false,
      keep_alive: keepAlive,
      think,
      options
    };

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama chat HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const raw = extractAssistantText(data);
    const final = finalizeModelReply(raw);
    if (!final) {
      console.warn(
        '[ollama] Empty assistant text after parse (chat). message keys:',
        data.message ? Object.keys(data.message) : '(none)',
        'contentLen=',
        data.message?.content != null ? String(data.message.content).length : 0,
        'thinkingLen=',
        data.message?.thinking != null ? String(data.message.thinking).length : 0,
        'done_reason=',
        data.done_reason
      );
    }
    return final;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkOllamaHealth() {
  const c = getCfg();
  const baseUrl = String(c.server?.baseUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    return { ok: false, error: 'server.baseUrl empty in config/ollama.json', baseUrl: '(unset)' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map(m => m.name || m.model).filter(Boolean);
    return { ok: true, models, baseUrl, configPath: c._configPath };
  } catch (e) {
    return { ok: false, error: e.message, baseUrl, configPath: c._configPath };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Split long text into Discord-safe chunks.
 * Prefer paragraph / line / word boundaries when strategy is "paragraph".
 */
function splitMessage(text, maxLen) {
  const limit = Math.min(Math.max(1, maxLen || DISCORD_HARD_LIMIT), DISCORD_HARD_LIMIT);
  if (!text || text.length <= limit) return text ? [text] : [];

  const strategy = getCfg().response?.splitStrategy || 'paragraph';
  const chunks = [];
  let remaining = text;

  while (remaining.length > limit) {
    let cut = limit;

    if (strategy === 'paragraph' || strategy === 'smart') {
      const window = remaining.slice(0, limit);
      const para = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\r\n\r\n'));
      const line = window.lastIndexOf('\n');
      const space = window.lastIndexOf(' ');
      if (para > limit * 0.4) cut = para;
      else if (line > limit * 0.5) cut = line;
      else if (space > limit * 0.5) cut = space;
    } else if (strategy === 'line') {
      const window = remaining.slice(0, limit);
      const line = window.lastIndexOf('\n');
      if (line > limit * 0.5) cut = line;
    }

    let piece = remaining.slice(0, cut).trimEnd();
    // Avoid empty pieces if cut landed on whitespace only
    if (!piece) {
      piece = remaining.slice(0, limit);
      cut = limit;
    }
    chunks.push(piece);
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function applyAffixes(text) {
  const r = getCfg().response || {};
  const prefix = r.prefix || '';
  const suffix = r.suffix || '';
  return `${prefix}${text}${suffix}`;
}

function getAllowedMentions() {
  const am = getCfg().response?.allowedMentions;
  if (!am || typeof am !== 'object') {
    return { parse: [], repliedUser: true };
  }
  return am;
}

async function sendSplitReply(message, content) {
  const r = getCfg().response || {};
  const maxPer = Math.min(r.maxCharsPerMessage ?? DISCORD_HARD_LIMIT, DISCORD_HARD_LIMIT);
  const maxTotal = r.maxTotalChars ?? 8000;

  let body = applyAffixes(content);
  if (body.length > maxTotal) {
    body = body.slice(0, maxTotal - 20) + '\n…(truncated)';
  }

  const chunks = splitMessage(body, maxPer);
  if (!chunks.length) return;

  const opts = { allowedMentions: getAllowedMentions() };
  let first = await message.reply({ content: chunks[0], ...opts });
  for (let i = 1; i < chunks.length; i++) {
    // Chain replies so multi-part stays threaded under the user message
    first = await message.channel.send({ content: chunks[i], reply: { messageReference: first.id }, ...opts });
  }
}

function checkRateLimit(userId) {
  const rl = getCfg().rateLimit || {};
  if (rl.enabled === false) return { ok: true };

  const now = Date.now();
  const cooldown = rl.cooldownMs ?? 2500;
  const key = rl.perUser !== false ? userId : 'global';
  const last = cooldowns.get(key) || 0;
  if (now - last < cooldown) {
    return { ok: false, remainingMs: cooldown - (now - last) };
  }
  cooldowns.set(key, now);
  return { ok: true };
}

async function handleAiMessage(message, client) {
  const c = getCfg();
  if (c.enabled === false) return;

  const { trigger } = await shouldTrigger(message, client);
  if (!trigger) return;

  let prompt = stripBotMentions(message.content || '', client);

  // When replying to the bot with empty body, try using nothing → empty prompt message
  if (!prompt) {
    const emptyMsg = c.response?.emptyPromptMessage;
    if (emptyMsg) {
      try {
        await message.reply({ content: emptyMsg, allowedMentions: getAllowedMentions() });
      } catch {
        // ignore
      }
    }
    return;
  }

  const flightKey = `${message.channelId}:${message.author.id}`;
  if (inFlight.has(flightKey)) {
    const busy = c.rateLimit?.busyMessage;
    if (busy) {
      try {
        await message.reply({ content: busy, allowedMentions: getAllowedMentions() });
      } catch {
        // ignore
      }
    }
    return;
  }

  const rl = checkRateLimit(message.author.id);
  if (!rl.ok) return; // silent cooldown drop (avoids spam)

  const hCfg = c.history || {};
  const key = historyKey(message, hCfg.scope || 'channel');

  let userContent = prompt;
  if (hCfg.includeUsernames) {
    const name = message.member?.displayName || message.author.username || 'User';
    userContent = `${name}: ${prompt}`;
  }

  inFlight.add(flightKey);

  let typingInterval = null;
  try {
    if (c.response?.showTyping !== false && message.channel?.sendTyping) {
      await message.channel.sendTyping().catch(() => {});
      typingInterval = setInterval(() => {
        message.channel.sendTyping().catch(() => {});
      }, 8000);
    }

    const prior = getHistoryMessages(key);
    const replyText = await callOllama(userContent, prior);

    if (!replyText) {
      // Empty content is the common Qwen3.5-thinking pitfall; always log it.
      console.warn(
        '[ollama] Model returned no user-visible text (HTTP may still be 200). ' +
          'If using a thinking model, set server.think=false in config/ollama.json.'
      );
      await message.reply({
        content: c.response?.errorMessage || 'Empty response from model.',
        allowedMentions: getAllowedMentions()
      });
      return;
    }

    pushHistory(key, 'user', userContent);
    pushHistory(key, 'assistant', replyText);

    await sendSplitReply(message, replyText);
  } catch (e) {
    console.error('[ollama] Inference error:', e.message);
    try {
      await message.reply({
        content: c.response?.errorMessage || `Error: ${e.message}`,
        allowedMentions: getAllowedMentions()
      });
    } catch {
      // ignore
    }
  } finally {
    if (typingInterval) clearInterval(typingInterval);
    inFlight.delete(flightKey);
  }
}

module.exports = {
  init(client) {
    // STRICT: every main.js start /modules reload re-reads ollama.json from disk
    const loaded = reloadConfigFromDisk('init');

    if (loaded.history?.clearOnRestart) {
      historyStore.clear();
    }

    // Avoid stacking listeners on /modules reload
    if (client._ollamaMessageHandler) {
      client.removeListener('messageCreate', client._ollamaMessageHandler);
    }

    const handler = async (message) => {
      try {
        if (!client.isModuleEnabled(MODULE_NAME)) return;
        await handleAiMessage(message, client);
      } catch (e) {
        console.error('[ollama] Unhandled message error:', e.message);
      }
    };

    client._ollamaMessageHandler = handler;
    client.on('messageCreate', handler);

    console.log(
      `[ollama] AI agent ready (config strictly from disk)\n` +
        `         path=${loaded._configPath}\n` +
        `         fromFile=${loaded._loadedFromFile} hash=${loaded._rawHash}\n` +
        `         model=${loaded.model}\n` +
        `         server=${loaded.server?.baseUrl} think=${loaded.server?.think}`
    );
  },

  data: new SlashCommandBuilder()
    .setName('ollama')
    .setDescription('Local Ollama AI agent controls')
    .addSubcommand(sc => sc.setName('status').setDescription('Show Ollama module status and connectivity'))
    .addSubcommand(sc => sc.setName('reload').setDescription('Reload config/ollama.json from disk (admin)'))
    .addSubcommand(sc =>
      sc
        .setName('clear-history')
        .setDescription('Clear conversation history (admin: all or this channel)')
        .addStringOption(o =>
          o
            .setName('scope')
            .setDescription('What to clear')
            .setRequired(false)
            .addChoices(
              { name: 'This channel', value: 'channel' },
              { name: 'Everything', value: 'all' }
            )
        )
    )
    .addSubcommand(sc =>
      sc
        .setName('ask')
        .setDescription('Ask the local AI a one-shot question (does not require a mention)')
        .addStringOption(o =>
          o.setName('prompt').setDescription('Your question or prompt — leave empty to compose it in a modal').setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('private').setDescription('Reply ephemerally (only you see it)').setRequired(false)
        )
    )
    .addSubcommand(sc =>
      sc
        .setName('model')
        .setDescription('Get or set the Ollama model name (admin)')
        .addStringOption(o =>
          o.setName('name').setDescription('Model name e.g. llama3.2, mistral, qwen2.5').setRequired(false)
        )
    )
    .addSubcommand(sc =>
      sc
        .setName('config')
        .setDescription('Show a summary of the current ollama config (admin)')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;
    const isAdmin = client.isAdmin(interaction.member || interaction.user);

    if (sub === 'status') {
      const c = getCfg();
      const health = await checkOllamaHealth();
      const histCount = historyStore.size;
      const sysPreview = String(c.systemPrompt || '').slice(0, 200) || '(empty)';
      const embed = new EmbedBuilder()
        .setTitle('Ollama AI Agent')
        .setColor(health.ok ? 0x57f287 : 0xed4245)
        .addFields(
          { name: 'Module', value: client.isModuleEnabled(MODULE_NAME) ? '✅ enabled' : '❌ disabled', inline: true },
          { name: 'Config enabled', value: c.enabled !== false ? 'yes' : 'no', inline: true },
          { name: 'From file', value: c._loadedFromFile ? '✅ yes' : '❌ defaults only', inline: true },
          { name: 'Model', value: `\`${c.model}\``, inline: true },
          { name: 'Server', value: `\`${c.server?.baseUrl}\``, inline: true },
          { name: 'API', value: `\`${c.server?.api}\``, inline: true },
          {
            name: 'Config file',
            value: `\`${c._configPath || configPath()}\`${c._loadError ? `\n⚠️ ${c._loadError}` : ''}`
          },
          {
            name: 'System prompt (preview)',
            value: sysPreview.length > 190 ? sysPreview.slice(0, 190) + '…' : sysPreview
          },
          {
            name: 'Connectivity',
            value: health.ok
              ? `✅ reachable\nModels: ${health.models.slice(0, 12).join(', ') || '(none listed)'}`
              : `❌ unreachable — ${health.error}`
          },
          {
            name: 'Triggers',
            value: `mention=${c.triggers?.onMention !== false}, replyToBot=${c.triggers?.onReplyToBot !== false}`,
            inline: true
          },
          {
            name: 'History',
            value: c.history?.enabled
              ? `on · scope=\`${c.history.scope}\` · max=${c.history.maxMessages} · sessions=${histCount}`
              : 'off',
            inline: true
          },
          {
            name: 'Inference (from file)',
            value:
              '```json\n' +
              JSON.stringify(
                {
                  temperature: c.inference?.temperature,
                  num_ctx: c.inference?.num_ctx,
                  num_predict: c.inference?.num_predict,
                  top_p: c.inference?.top_p,
                  top_k: c.inference?.top_k
                },
                null,
                2
              ) +
              '\n```'
          }
        )
        .setFooter({ text: 'Source of truth: config/ollama.json (auto-reloads on file change)' });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'reload') {
      if (!isAdmin) {
        await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
        return;
      }
      // STRICT: always re-read ollama.json bytes from disk (ignore any in-memory state)
      const loaded = reloadConfigFromDisk('slash-reload');
      await interaction.reply({
        content:
          `Reloaded from disk:\n` +
          `\`${loaded._configPath}\`\n` +
          `fromFile=\`${loaded._loadedFromFile}\` · hash=\`${loaded._rawHash}\` · mtime=\`${loaded._mtimeMs ? new Date(loaded._mtimeMs).toISOString() : 'n/a'}\`\n` +
          `model=\`${loaded.model}\` · server=\`${loaded.server?.baseUrl}\` · think=\`${loaded.server?.think}\`\n` +
          `num_ctx=\`${loaded.inference?.num_ctx}\` · num_predict=\`${loaded.inference?.num_predict}\` · keepAlive=\`${loaded.server?.keepAlive}\``,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (sub === 'clear-history') {
      if (!isAdmin) {
        await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
        return;
      }
      const scope = interaction.options.getString('scope') || 'channel';
      let n;
      if (scope === 'all') {
        n = historyStore.size;
        clearHistory();
        await interaction.reply({ content: `Cleared all history (${n} session(s)).`, flags: MessageFlags.Ephemeral });
      } else {
        const key = `ch:${interaction.channelId}`;
        n = clearHistory(key);
        // also clear channel-user keys for this channel
        n += clearHistory(`cu:${interaction.channelId}:`);
        await interaction.reply({
          content: `Cleared history for this channel (${n} session(s)).`,
          flags: MessageFlags.Ephemeral
        });
      }
      return;
    }

    if (sub === 'model') {
      if (!isAdmin) {
        await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
        return;
      }
      const name = interaction.options.getString('name');
      const c = getCfg();
      if (!name) {
        await interaction.reply({
          content: `Current model (from \`${c._configPath}\`): \`${c.model}\``,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const next = toDiskShape(c);
      next.model = name;
      const saved = saveConfig(next);
      await interaction.reply({
        content: `Model set to \`${saved.model}\` and written to \`${saved._configPath}\`.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (sub === 'config') {
      if (!isAdmin) {
        await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
        return;
      }
      const c = getCfg();
      // Show the actual on-disk shape (what ollama.json contains after merge fill)
      const summary = toDiskShape(c);
      const header = `**File:** \`${c._configPath}\`\n**fromFile:** ${c._loadedFromFile}\n`;
      const json = JSON.stringify(summary, null, 2);
      const body = header + '```json\n' + json + '\n```';
      if (body.length < 1800) {
        await interaction.reply({ content: body, flags: MessageFlags.Ephemeral });
      } else {
        await client.sendWithLimits(interaction, body, { flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'ask') {
      const promptOpt = interaction.options.getString('prompt');
      const ephemeral = interaction.options.getBoolean('private') || false;

      if (!promptOpt) {
        // No prompt option given: compose it in a modal (longer text, real
        // newlines). showModal() must be the FIRST response to this
        // interaction — execute() hasn't replied yet at this point.
        const modalSubmit = await showModal(interaction, {
          id: customId(MODULE, 'askmodal'),
          title: 'Zapytaj AI',
          fields: [{ id: 'prompt', label: 'Twoje pytanie / prompt', style: 'paragraph', required: true, maxLength: 2000 }]
        });
        if (!modalSubmit) return; // timed out
        await modalSubmit.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
        await runAsk(modalSubmit, modalSubmit.fields.getTextInputValue('prompt'), ephemeral);
        return;
      }

      await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
      await runAsk(interaction, promptOpt, ephemeral);
      return;
    }
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "ollama:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { action } = parseCustomId(interaction.customId);

    if (action === 'regen') {
      const entry = askCache.get(interaction.message.id);
      if (!entry) {
        await interaction.reply({ content: '⌛ Ten kontekst wygasł — użyj `/ollama ask` ponownie.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferUpdate();
      await runAsk(interaction, entry.prompt, entry.ephemeral);
      return;
    }

    if (action === 'clearhist') {
      if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
        await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
        return;
      }
      clearHistory(`ch:${interaction.channelId}`);
      await interaction.reply({ content: '🗑️ Historia tego kanału wyczyszczona.', flags: MessageFlags.Ephemeral });
    }
  }
};

// Runs one ask/regenerate turn on an already-deferred interaction (slash
// command, modal submit, or a component interaction after deferUpdate()) and
// edits its reply in place — including the follow-up chunks Discord forces
// on content over 2000 chars (see INTERACTIONS.md §1, the one legitimate
// followUp case). Caches {prompt, ephemeral} on the resulting message id so
// the 🔄 Regeneruj button can re-ask without needing the original prompt text
// in its customId (which is capped at 100 chars).
async function runAsk(interaction, prompt, ephemeral) {
  const c = getCfg();
  try {
    let history = [];
    if (c.history?.enabled && interaction.channelId) {
      history = getHistoryMessages(`ch:${interaction.channelId}`);
    }

    const replyText = await callOllama(prompt, history);
    if (!replyText) {
      await interaction.editReply(c.response?.errorMessage || 'Empty response from model.');
      return;
    }

    if (c.history?.enabled && interaction.channelId) {
      const key = `ch:${interaction.channelId}`;
      pushHistory(key, 'user', prompt);
      pushHistory(key, 'assistant', replyText);
    }

    const maxPer = Math.min(c.response?.maxCharsPerMessage ?? DISCORD_HARD_LIMIT, DISCORD_HARD_LIMIT);
    const maxTotal = c.response?.maxTotalChars ?? 8000;
    let body = applyAffixes(replyText);
    if (body.length > maxTotal) body = body.slice(0, maxTotal - 20) + '\n…(truncated)';

    const chunks = splitMessage(body, maxPer);
    const msg = await interaction.editReply({ content: chunks[0], components: askRow(), allowedMentions: getAllowedMentions() });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({
        content: chunks[i],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        allowedMentions: getAllowedMentions()
      });
    }

    if (msg?.id) askCache.set(msg.id, { prompt, ephemeral, expiresAt: Date.now() + 15 * 60_000 });
  } catch (e) {
    console.error('[ollama] ask error:', e.message);
    await interaction.editReply(c.response?.errorMessage || `Error: ${e.message}`);
  }
}
