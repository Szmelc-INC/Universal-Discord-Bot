const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');

const TOKEN_PATH = path.join(__dirname, '.env');
const MODULES = path.join(__dirname, 'modules');

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function loadModules() {
  const modules = [];
  for (const file of fs.readdirSync(MODULES).filter(f => f.endsWith('.js'))) {
    try {
      delete require.cache[require.resolve(path.join(MODULES, file))];
      const mod = require(path.join(MODULES, file));
      if (mod?.data?.name && typeof mod.execute === 'function') {
        modules.push(mod);
        console.log(`Loaded /${mod.data.name}`);
      }
    } catch (e) {
      console.error(`Failed ${file}: ${e.message}`);
    }
  }
  return modules;
}

async function start(token) {
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
  const modules = loadModules();
  modules.forEach(m => client.commands.set(m.data.name, m));
  modules.forEach(m => {
    if (typeof m.init === 'function') {
      try { m.init(client); } catch (e) { console.error(e.message); }
    }
  });

  client.once('clientReady', async () => {
    const rest = new REST({ version: '10' }).setToken(token);
    const body = modules.map(m => m.data.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    console.log(`Ready as ${client.user.tag} | ${body.length} commands`);
  });

  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;
    const cmd = client.commands.get(i.commandName);
    if (!cmd) return;
    try { await cmd.execute(i); }
    catch (e) { console.error(e); }
  });

  await client.login(token);
}

const tokens = loadJSON(TOKEN_PATH);
const name = process.argv[2] || Object.keys(tokens)[0];

if (!name || !tokens[name]) {
  console.error('Usage: node bot.js <botName>');
  console.error('Available:', Object.keys(tokens).join(', ') || '(none)');
  process.exit(1);
}

start(tokens[name]).catch(console.error);
