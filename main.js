const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes, MessageFlags } = require('discord.js');
const inquirer = require('inquirer').default;
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const TOKEN_PATH = path.join(__dirname, '.env');
const CONFIG_PATH = path.join(__dirname, 'config.json');

const COLORS = {
  reset: '\x1b[0m',
  debug: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m'
};

function loadJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function bustLibCache() {
  // lib/interactions.js (the shared interaction-standard helper) is required
  // by modules via a resolved absolute path, so it survives module cache
  // clears untouched. Bust it too so /modules reload actually picks up edits.
  const libDir = path.join(__dirname, 'lib');
  if (!fs.existsSync(libDir)) return;
  for (const file of fs.readdirSync(libDir).filter(f => f.endsWith('.js'))) {
    delete require.cache[require.resolve(path.join(libDir, file))];
  }
}

async function loadModules(modulesFolder, enabled = [], disabled = [], debug = false) {
  bustLibCache();
  const modules = [];
  const loadedNames = [];
  const failed = [];
  const skipped = [];

  const files = fs.readdirSync(modulesFolder).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const name = file.slice(0, -3);

    // Whitelist mode
    if (enabled.length && !enabled.includes(name)) {
      skipped.push(name);
      continue;
    }
    if (disabled.includes(name)) {
      skipped.push(name);
      continue;
    }

    try {
      // Clear from cache so reloads actually re-execute the file (important for development)
      delete require.cache[require.resolve(path.join(modulesFolder, file))];

      const mod = require(path.join(modulesFolder, file));

      if (!mod || !mod.data || !mod.data.name) {
        throw new Error('Module does not export a valid { data: SlashCommandBuilder, execute }');
      }

      modules.push(mod);
      loadedNames.push(mod.data.name);
      console.log(`${COLORS.debug}[LOADED]${COLORS.reset} ${file} → /${mod.data.name}`);
    } catch (e) {
      failed.push(name);
      console.error(`${COLORS.error}[FAILED]${COLORS.reset} ${file}: ${e.message}`);
    }
  }

  console.log(
    `\n${COLORS.debug}=== Module Load Summary ===${COLORS.reset}\n` +
    `  Loaded : ${loadedNames.length} → ${loadedNames.join(', ') || '(none)'}\n` +
    `  Skipped: ${skipped.length}   → ${skipped.join(', ') || '(none)'}\n` +
    `  Failed : ${failed.length}   → ${failed.join(', ') || '(none)'}\n`
  );

  return modules;
}

async function registerCommands(client, commands, reload = false) {
  const rest = new REST({ version: '10' }).setToken(client.token);
  if (reload) {
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
  }
  for (const cmd of commands) {
    const json = cmd.data.toJSON();
    await rest.post(Routes.applicationCommands(client.user.id), { body: json });
  }
}

async function startBot(botName, config, tokens, options = {}) {
  const { debug = false, reload = false, log = false } = options;
  if (debug) {
    console.log(`${COLORS.debug}[DEBUG] starting bot ${botName}${COLORS.reset}`);
    console.log(fs.existsSync(TOKEN_PATH)
      ? `${COLORS.debug}[DEBUG] .discordrc found${COLORS.reset}`
      : `${COLORS.warn}[WARN] .discordrc missing${COLORS.reset}`);
  }
  const token = tokens[botName];
  if (!token) {
    console.log(`Token for ${botName} not found in .discordrc`);
    return;
  }

  const botConfig = (config.bots || {})[botName] || {
    modules_folder: 'modules',
    enabled_modules: [],
    disabled_modules: []
  };

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildVoiceStates
    ]
  });
  client.commands = new Collection();
  client.config = config;
  client.botConfig = botConfig;

  client.sendWithLimits = async (interaction, content = '', options = {}) => {
    const limits = client.config.limits || {};
    const maxLen = limits.maxMessageLength ?? 2000;
    const maxFiles = limits.maxFiles ?? 10;
    const maxFileSize = limits.maxFileSize ?? 10 * 1024 * 1024;
    const strategy = limits.strategy || 'truncate';

    const { files: optFiles = [], ...rest } = options;
    let files = optFiles.filter(f => {
      try {
        const att = f.attachment ?? f;
        if (Buffer.isBuffer(att)) return att.length <= maxFileSize;
        if (typeof att === 'string') return fs.statSync(att).size <= maxFileSize;
        if (att?.length) return att.length <= maxFileSize;
        return true;
      } catch {
        return false;
      }
    });
    if (files.length > maxFiles) files = files.slice(0, maxFiles);

    // Defer-aware: lands in the SAME message whether the caller already
    // deferred/replied or not. See lib/interactions.js `reply()` (this stays
    // a client method rather than importing that lib to avoid a require
    // cycle risk for modules that don't need the rest of the standard lib).
    const send = msg => {
      const payload = { ...rest, content: msg, files };
      return (interaction.deferred || interaction.replied)
        ? interaction.editReply(payload)
        : interaction.reply(payload);
    };

    if (content.length <= maxLen) {
      await send(content);
      return;
    }

    if (strategy === 'split') {
      const chunks = [];
      for (let i = 0; i < content.length; i += maxLen) {
        chunks.push(content.slice(i, i + maxLen));
      }
      await send(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ ...rest, content: chunks[i] });
      }
    } else if (strategy === 'file') {
      const buffer = Buffer.from(content, 'utf8');
      const filePayload = { ...rest, content: undefined, files: [{ attachment: buffer, name: 'message.txt' }] };
      if (buffer.length <= maxFileSize) {
        await ((interaction.deferred || interaction.replied)
          ? interaction.editReply(filePayload)
          : interaction.reply(filePayload));
      } else {
        await send(content.slice(0, maxLen));
      }
    } else {
      await send(content.slice(0, maxLen));
    }
  };


  client.isAdmin = (memberOrUser) => {
    const userId = memberOrUser?.id || memberOrUser?.user?.id;
    if (config.admins?.includes(userId)) return true;
    const roles = memberOrUser?.roles?.cache;
    if (roles && config.adminRoles) {
      for (const role of roles.values()) {
        if (config.adminRoles.includes(role.id)) return true;
      }
    }
    return false;
  };


  if (log) {
    const logFile = fs.createWriteStream(path.join(__dirname, `log_${botName}_${Date.now()}.log`));
    ['log', 'warn', 'error'].forEach(level => {
      const orig = console[level];
      console[level] = (...args) => {
        logFile.write(args.map(String).join(' ') + '\n');
        orig(...args);
      };
    });
  }

  const modulesFolder = path.join(__dirname, botConfig.modules_folder);
  client.modulesFolder = modulesFolder;

  client.configPath = CONFIG_PATH;

  client.saveConfig = () => {
    saveJSON(CONFIG_PATH, config);
  };

  client.getAllModuleNames = () => {
    try {
      return fs.readdirSync(client.modulesFolder)
        .filter(f => f.endsWith('.js'))
        .map(f => f.slice(0, -3));
    } catch {
      return [];
    }
  };

  client.isModuleEnabled = (name) => {
    const bc = client.botConfig || {};
    const enabled = bc.enabled_modules || [];
    const disabled = bc.disabled_modules || [];
    if (disabled.includes(name)) return false;
    if (enabled.length > 0) return enabled.includes(name);
    return true;
  };

  client.enableModule = (name) => {
    const bc = client.botConfig || {};
    bc.disabled_modules = (bc.disabled_modules || []).filter(m => m !== name);
    if (!bc.enabled_modules) bc.enabled_modules = [];
    if (!bc.enabled_modules.includes(name)) bc.enabled_modules.push(name);
    client.saveConfig();
  };

  client.disableModule = (name) => {
    const bc = client.botConfig || {};
    bc.enabled_modules = (bc.enabled_modules || []).filter(m => m !== name);
    if (!bc.disabled_modules) bc.disabled_modules = [];
    if (!bc.disabled_modules.includes(name)) bc.disabled_modules.push(name);
    client.saveConfig();
  };

  const modules = await loadModules(modulesFolder, botConfig.enabled_modules, botConfig.disabled_modules, debug);

  // Register slash commands
  modules.forEach(m => {
    if (m.data && m.data.name) {
      client.commands.set(m.data.name, m);
    }
  });

  // Initialize passive modules (responses, reaction roles, etc.)
  modules.forEach(m => {
    if (typeof m.init === 'function') {
      try {
        m.init(client);
      } catch (e) {
        console.error(`${COLORS.error}[INIT ERROR]${COLORS.reset} Failed to initialize module ${m.data?.name || 'unknown'}:`, e.message);
      }
    }
  });

  client.reloadAll = async () => {
    const mods = await loadModules(client.modulesFolder, client.botConfig.enabled_modules, client.botConfig.disabled_modules, debug);

    client.commands.clear();

    // Re-register slash commands
    mods.forEach(m => {
      if (m.data && m.data.name) {
        client.commands.set(m.data.name, m);
      }
    });

    await registerCommands(client, mods.filter(m => m.data && m.data.name), true);

    // Re-initialize passive modules
    mods.forEach(m => {
      if (typeof m.init === 'function') {
        try {
          m.init(client);
        } catch (e) {
          console.error(`${COLORS.error}[INIT ERROR]${COLORS.reset} Failed to re-initialize module:`, e.message);
        }
      }
    });
  };

  client.once('clientReady', async () => {
    await registerCommands(client, modules, reload);
    const loadedCmds = [...client.commands.keys()].sort();
    console.log(`${COLORS.debug}[READY]${COLORS.reset} ${client.user.tag} is online`);
    console.log(`${COLORS.debug}[COMMANDS]${COLORS.reset} Registered ${loadedCmds.length} slash commands: ${loadedCmds.join(', ')}`);

    // Restore last saved bot presence (if any)
    try {
      const presPath = path.join(__dirname, 'config', 'bot-presence.json');
      if (fs.existsSync(presPath)) {
        const saved = JSON.parse(fs.readFileSync(presPath, 'utf8'));
        if (saved?.type && saved?.text) {
          const { ActivityType } = require('discord.js');
          const typeMap = { playing: ActivityType.Playing, listening: ActivityType.Listening, watching: ActivityType.Watching, competing: ActivityType.Competing, streaming: ActivityType.Streaming, custom: ActivityType.Custom };
          await client.user.setPresence({
            activities: [{ name: saved.text, type: typeMap[saved.type] || ActivityType.Playing, url: saved.url || undefined }]
          });
          console.log(`${COLORS.debug}[PRESENCE]${COLORS.reset} Restored previous presence: ${saved.type} ${saved.text}`);
        }
      }
    } catch (e) {
      console.error('Failed to restore presence:', e.message);
    }
  });

  client.on('interactionCreate', async interaction => {
    const bl = config.blacklist || {};
    const isBlacklisted =
      (bl.users && bl.users.includes(interaction.user.id)) ||
      (interaction.member && bl.roles && interaction.member.roles.cache.some(r => bl.roles.includes(r.id))) ||
      (bl.guilds && bl.guilds.includes(interaction.guildId));
    if (isBlacklisted) return;

    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;
      if (!client.isModuleEnabled(interaction.commandName)) {
        await interaction.reply({ content: 'This module is currently disabled.', flags: MessageFlags.Ephemeral });
        return;
      }
      try { await cmd.execute(interaction); }
      catch (e) { console.error(e); }
    } else if (interaction.isAutocomplete()) {
      const cmd = client.commands.get(interaction.commandName);
      if (cmd && cmd.autocomplete) {
        try { await cmd.autocomplete(interaction); }
        catch (e) { console.error(e); }
      }
    } else if (
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isUserSelectMenu() ||
      interaction.isRoleSelectMenu() ||
      interaction.isChannelSelectMenu() ||
      interaction.isMentionableSelectMenu() ||
      interaction.isModalSubmit()
    ) {
      // Standard interaction-component routing. customId convention is
      // "modname:action:payload" (see lib/interactions.js customId()).
      // Modules opt in by exporting handleComponent(interaction) and/or
      // handleModal(interaction) alongside { data, execute }. Modules that
      // only ever bind short-lived collectors (message.createMessageComponentCollector,
      // e.g. tictactoe) never reach here — the collector claims the event first.
      const { modName } = require('./lib/interactions').parseCustomId(interaction.customId);
      const cmd = client.commands.get(modName);
      if (!cmd) return;
      if (!client.isModuleEnabled(modName)) return;
      try {
        if (interaction.isModalSubmit() && cmd.handleModal) await cmd.handleModal(interaction);
        else if (!interaction.isModalSubmit() && cmd.handleComponent) await cmd.handleComponent(interaction);
      } catch (e) {
        console.error(`[interactionCreate] component/modal handler error (${modName}):`, e);
      }
    }
  });

  if (debug) {
    client.on('debug', msg => console.log(`${COLORS.debug}[DEBUG]${COLORS.reset} ${msg}`));
    client.on('warn', msg => console.warn(`${COLORS.warn}[WARN]${COLORS.reset} ${msg}`));
    client.on('error', err => console.error(`${COLORS.error}[ERROR]${COLORS.reset}`, err));
  }

  try {
    await client.login(token);
  } catch (e) {
    console.error('Failed to login:', e.message);
  }
}

async function enableDisableModule(config, botName, action) {
  const bots = config.bots || {};
  const botConfig = bots[botName] || {
    modules_folder: 'modules',
    enabled_modules: [],
    disabled_modules: []
  };
  bots[botName] = botConfig;
  const modulesFolder = path.join(__dirname, botConfig.modules_folder);
  const allModules = fs.readdirSync(modulesFolder).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));
  const choices = allModules.map(m => ({ name: m, value: m }));
  const { module } = await inquirer.prompt([{ type: 'list', name: 'module', message: `${action} which module?`, choices }]);
  if (action === 'Enable') {
    botConfig.disabled_modules = botConfig.disabled_modules.filter(m => m !== module);
    if (!botConfig.enabled_modules.includes(module)) botConfig.enabled_modules.push(module);
  } else {
    botConfig.enabled_modules = botConfig.enabled_modules.filter(m => m !== module);
    if (!botConfig.disabled_modules.includes(module)) botConfig.disabled_modules.push(module);
  }
  saveJSON(CONFIG_PATH, config);
}

async function menu(options = {}) {
  const config = fs.existsSync(CONFIG_PATH) ? loadJSON(CONFIG_PATH) : { bots: {} };
  const tokens = fs.existsSync(TOKEN_PATH) ? loadJSON(TOKEN_PATH) : {};
  const bots = Object.keys(tokens);
  while (true) {
    const { bot } = await inquirer.prompt([{ type: 'list', name: 'bot', message: 'Select bot', choices: bots.concat(['Exit']) }]);
    if (bot === 'Exit') break;
    const { action } = await inquirer.prompt([{ type: 'list', name: 'action', message: 'Action', choices: ['Start', 'Enable Module', 'Disable Module', 'Back'] }]);
    if (action === 'Start') {
      await startBot(bot, config, tokens, options);
    } else if (action === 'Enable Module') {
      await enableDisableModule(config, bot, 'Enable');
    } else if (action === 'Disable Module') {
      await enableDisableModule(config, bot, 'Disable');
    }
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('bot', { type: 'string', describe: 'Bot name to start' })
    .option('debug', { type: 'boolean', describe: 'Enable verbose debugging', default: false })
    .option('reload', { type: 'boolean', describe: 'Unregister and reload commands on start', default: false })
    .option('log', { type: 'boolean', describe: 'Log console output to file', default: false })
    .argv;
  const config = fs.existsSync(CONFIG_PATH) ? loadJSON(CONFIG_PATH) : { bots: {} };
  const tokens = fs.existsSync(TOKEN_PATH) ? loadJSON(TOKEN_PATH) : {};
  const options = { debug: argv.debug, reload: argv.reload, log: argv.log };
  const botNames = Object.keys(tokens);
  if (argv.bot) {
    if (!tokens[argv.bot]) {
      console.log(`Bot ${argv.bot} not found. Available bots: ${botNames.join(', ')}`);
      return;
    }
    await startBot(argv.bot, config, tokens, options);
  } else if (botNames.length === 1) {
    await startBot(botNames[0], config, tokens, options);
  } else {
    await menu(options);
  }
}

main();
