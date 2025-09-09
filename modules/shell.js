const { SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');

const ADMIN_ID = '818166724641030193';

function run(cmd) {
  return new Promise(resolve => {
    exec(cmd, (err, stdout, stderr) => {
      resolve((stdout || stderr || err?.message || '').trim());
    });
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shell')
    .setDescription('Execute a shell command')
    .addStringOption(o => o.setName('command').setDescription('Command to run').setRequired(true)),
  async execute(interaction) {
    if (interaction.user.id !== ADMIN_ID) {
      await interaction.reply('You are not authorized to use this command.');
      return;
    }
    const cmd = interaction.options.getString('command');
    const output = await run(cmd);
    await interaction.reply(`\u200b${'```'}\n${output}\n${'```'}`);
  }
};
