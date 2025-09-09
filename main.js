const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const inquirer = require('inquirer').default;
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const TOKEN_PATH = path.join(__dirname, '.discordrc');
const CONFIG_PATH = path.join(__dirname, 'botconfig.json');

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

async function loadModules(modulesFolder, enabled = [], disabled = [], debug = false) {
  const modules = [];
  const files = fs.readdirSync(modulesFolder).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const name = file.slice(0, -3);
    if (enabled.length && !enabled.includes(name)) continue;
    if (disabled.includes(name)) continue;
    try {
      const mod = require(path.join(modulesFolder, file));
      modules.push(mod);
      if (debug) console.log(`${COLORS.debug}[DEBUG]${COLORS.reset} loaded module ${file}`);
    } catch (e) {
      console.error(`${COLORS.error}[DEBUG] failed to load module ${file}:${COLORS.reset}`, e.message);
    }
  }
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

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
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

    const send = msg => interaction.reply({ ...rest, content: msg, files });

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
      if (buffer.length <= maxFileSize) {
        await interaction.reply({ ...rest, files: [{ attachment: buffer, name: 'message.txt' }] });
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

  const modules = await loadModules(modulesFolder, botConfig.enabled_modules, botConfig.disabled_modules, debug);
  modules.forEach(m => client.commands.set(m.data.name, m));

  client.reloadAll = async () => {
    const mods = await loadModules(client.modulesFolder, client.botConfig.enabled_modules, client.botConfig.disabled_modules, debug);
    client.commands.clear();
    mods.forEach(m => client.commands.set(m.data.name, m));
    await registerCommands(client, mods, true);
  };

  client.once('ready', async () => {
    await registerCommands(client, modules, reload);
    console.log(`${client.user.tag} ready`);
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
      try { await cmd.execute(interaction); }
      catch (e) { console.error(e); }
    } else if (interaction.isAutocomplete()) {
      const cmd = client.commands.get(interaction.commandName);
      if (cmd && cmd.autocomplete) {
        try { await cmd.autocomplete(interaction); }
        catch (e) { console.error(e); }
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
