const { SlashCommandBuilder } = require('discord.js');
const { execFile } = require('child_process');

const allowed = {
  figlet: ['figlet'],
  toilet: ['toilet'],
  cowsay: ['cowsay'],
  fortune: ['fortune'],
  uptime: ['uptime']
};

function run(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, (err, stdout, stderr) => {
      resolve((stdout || stderr || err?.message || '').trim());
    });
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cmd')
    .setDescription('Run a whitelisted shell command')
    .addStringOption(opt => opt.setName('command').setDescription('Command with args').setRequired(true)),
  async execute(interaction) {
    const input = interaction.options.getString('command');
    const parts = input.split(/\s+/);
    const base = parts.shift();
    if (!allowed[base]) {
      await interaction.reply('This command is not allowed.');
      return;
    }
    const output = await run(allowed[base][0], parts);
    await interaction.reply(`\u200b${'```'}\n${output}\n${'```'}`);
  }
};
