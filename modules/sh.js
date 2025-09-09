const { SlashCommandBuilder } = require('discord.js');
const { exec, execFile } = require('child_process');

const allowed = {
  figlet: ['figlet'],
  toilet: ['toilet'],
  cowsay: ['cowsay'],
  fortune: ['fortune'],
  uptime: ['uptime'],
};

function run(cmd) {
  return new Promise(resolve => {
    exec(cmd, (err, stdout, stderr) => {
      resolve((stdout || stderr || err?.message || '').trim());
    });
  });
}

function runFile(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, (err, stdout, stderr) => {
      resolve((stdout || stderr || err?.message || '').trim());
    });
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sh')
    .setDescription('Execute shell commands')
    .addSubcommand(sc =>
      sc
        .setName('user')
        .setDescription('Run a whitelisted command')
        .addStringOption(o =>
          o
            .setName('command')
            .setDescription('Command to run')
            .setRequired(true)
            .addChoices(
              ...Object.keys(allowed).map(k => ({ name: k, value: k }))
            )
        )
        .addStringOption(o =>
          o.setName('args').setDescription('Arguments for the command')
        )
    )
    .addSubcommand(sc =>
      sc
        .setName('sudo')
        .setDescription('Run any command')
        .addStringOption(o =>
          o.setName('command').setDescription('Command to run').setRequired(true)
        )
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'user') {
      const cmd = interaction.options.getString('command');
      const argsStr = interaction.options.getString('args') || '';
      const args = argsStr.split(/\s+/).filter(Boolean);
      const output = await runFile(allowed[cmd][0], args);
      await interaction.client.sendWithLimits(interaction, `\u200b\`\`\`\n${output}\n\`\`\``);
    } else if (sub === 'sudo') {
      if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
        await interaction.reply('You are not authorized to use this command.');
        return;
      }
      const command = interaction.options.getString('command');
      const output = await run(command);
      await interaction.client.sendWithLimits(interaction, `\u200b\`\`\`\n${output}\n\`\`\``);
    } else {
      await interaction.reply('Unknown subcommand.');
    }
  }
};

