const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { exec, execFile } = require('child_process');

const allowed = {
  figlet: ['figlet'],
  toilet: ['toilet'],
  cowsay: ['cowsay'],
  fortune: ['fortune'],
  uptime: ['uptime']
};

const EXEC_OPTS = { timeout: 30000, maxBuffer: 1024 * 1024 };

function run(cmd) {
  return new Promise(resolve => {
    exec(cmd, EXEC_OPTS, (err, stdout, stderr) => {
      resolve((stdout || stderr || err?.message || '').trim().slice(0, 50000));
    });
  });
}

function runFile(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, EXEC_OPTS, (err, stdout, stderr) => {
      resolve((stdout || stderr || err?.message || '').trim().slice(0, 50000));
    });
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shell')
    .setDescription('Execute shell commands — admins get full access, others are limited to safe commands')
    .addStringOption(o =>
      o.setName('command')
        .setDescription('Full command to run (e.g. "uptime" or "ls -la")')
        .setRequired(true)
    ),
  async execute(interaction) {
    const full = interaction.options.getString('command') || '';
    const parts = full.trim().split(/\s+/);
    const base = parts[0];
    const args = parts.slice(1);

    const isAdmin = interaction.client.isAdmin(interaction.member || interaction.user);

    if (!isAdmin) {
      if (!allowed[base]) {
        await interaction.reply({ content: 'You are not allowed to run this command. Available: ' + Object.keys(allowed).join(', '), flags: MessageFlags.Ephemeral });
        return;
      }
      const output = await runFile(allowed[base][0], args);
      await interaction.client.sendWithLimits(interaction, `\u200b\`\`\`\n${output}\n\`\`\``);
      return;
    }

    // Admin: full power
    const output = await run(full);
    await interaction.client.sendWithLimits(interaction, `\u200b\`\`\`\n${output}\n\`\`\``);
  }
};

