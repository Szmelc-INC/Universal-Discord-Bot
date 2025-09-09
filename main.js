const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const inquirer = require('inquirer').default;
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const TOKEN_PATH = path.join(__dirname, '.discordrc');
const GLOBAL_CONFIG_PATH = path.join(__dirname, 'botconfig.json');

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
      if (debug) console.log(`[DEBUG] loaded module ${file}`);
    } catch (e) {
      console.error(`[DEBUG] failed to load module ${file}:`, e.message);
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
  const { debug = false, reload = false } = options;
  if (debug) {
    console.log(`[DEBUG] starting bot ${botName}`);
    console.log(fs.existsSync(TOKEN_PATH) ? '[DEBUG] .discordrc found' : '[DEBUG] .discordrc missing');
  }
  const botConfig = config[botName];
  if (!botConfig) {
    console.log(`Bot ${botName} not found.`);
    return;
  }
  const token = tokens[botConfig.tokenKey];
  if (!token) {
    console.log(`Token for ${botName} not found in .discordrc`);
    return;
  }

  const globalConfig = fs.existsSync(GLOBAL_CONFIG_PATH) ? loadJSON(GLOBAL_CONFIG_PATH) : {};
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.commands = new Collection();
  client.config = globalConfig;

  const modulesFolder = path.join(__dirname, botConfig.modules_folder);
  client.modulesFolder = modulesFolder;
  client.botConfig = botConfig;

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
    client.on('debug', msg => console.log('[DEBUG]', msg));
    client.on('warn', msg => console.warn('[WARN]', msg));
    client.on('error', err => console.error('[ERROR]', err));
  }

  try {
    await client.login(token);
  } catch (e) {
    console.error('Failed to login:', e.message);
  }
}

async function enableDisableModule(config, botName, action) {
  const botConfig = config[botName];
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
  const config = loadJSON(CONFIG_PATH);
  const tokens = fs.existsSync(TOKEN_PATH) ? loadJSON(TOKEN_PATH) : {};
  const bots = Object.keys(config);
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
    .argv;
  const config = loadJSON(CONFIG_PATH);
  const tokens = fs.existsSync(TOKEN_PATH) ? loadJSON(TOKEN_PATH) : {};
  const options = { debug: argv.debug, reload: argv.reload };
  if (argv.bot) {
    await startBot(argv.bot, config, tokens, options);
  } else {
    await menu(options);
  }
}

main();
