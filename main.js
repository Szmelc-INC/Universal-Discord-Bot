const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const inquirer = require('inquirer').default;
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const TOKEN_PATH = path.join(__dirname, '.discordrc');

function loadJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function loadModules(modulesFolder, enabled = [], disabled = []) {
  const modules = [];
  const files = fs.readdirSync(modulesFolder).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const name = file.slice(0, -3);
    if (enabled.length && !enabled.includes(name)) continue;
    if (disabled.includes(name)) continue;
    const mod = require(path.join(modulesFolder, file));
    modules.push(mod);
  }
  return modules;
}

async function registerCommands(client, commands) {
  const rest = new REST({ version: '10' }).setToken(client.token);
  const existing = await rest.get(Routes.applicationCommands(client.user.id));
  for (const cmd of commands) {
    const json = cmd.data.toJSON();
    const current = existing.find(c => c.name === json.name && c.type === json.type);
    if (current) {
      await rest.patch(Routes.applicationCommand(client.user.id, current.id), { body: json });
    } else {
      await rest.post(Routes.applicationCommands(client.user.id), { body: json });
    }
  }
}

async function startBot(botName, config, tokens) {
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

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.commands = new Collection();
  const modulesFolder = path.join(__dirname, botConfig.modules_folder);
  const modules = await loadModules(modulesFolder, botConfig.enabled_modules, botConfig.disabled_modules);
  modules.forEach(m => client.commands.set(m.data.name, m));

  client.once('clientReady', async () => {
    await registerCommands(client, modules);
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

async function menu() {
  const config = loadJSON(CONFIG_PATH);
  const tokens = fs.existsSync(TOKEN_PATH) ? loadJSON(TOKEN_PATH) : {};
  const bots = Object.keys(config);
  while (true) {
    const { bot } = await inquirer.prompt([{ type: 'list', name: 'bot', message: 'Select bot', choices: bots.concat(['Exit']) }]);
    if (bot === 'Exit') break;
    const { action } = await inquirer.prompt([{ type: 'list', name: 'action', message: 'Action', choices: ['Start', 'Enable Module', 'Disable Module', 'Back'] }]);
    if (action === 'Start') {
      await startBot(bot, config, tokens);
    } else if (action === 'Enable Module') {
      await enableDisableModule(config, bot, 'Enable');
    } else if (action === 'Disable Module') {
      await enableDisableModule(config, bot, 'Disable');
    }
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv)).option('bot', { type: 'string', describe: 'Bot name to start' }).argv;
  const config = loadJSON(CONFIG_PATH);
  const tokens = fs.existsSync(TOKEN_PATH) ? loadJSON(TOKEN_PATH) : {};
  if (argv.bot) {
    await startBot(argv.bot, config, tokens);
  } else {
    await menu();
  }
}

main();
