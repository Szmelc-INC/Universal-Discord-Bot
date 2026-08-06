const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'dm-logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile(userId) {
  return path.join(LOG_DIR, `${userId}.txt`);
}

module.exports = {
  init(client) {
    ensureLogDir();

    client.on('messageCreate', (message) => {
      if (!client.isModuleEnabled('dms')) return;

      if (message.channel.type === 1) { // DMChannel
        const logFile = getLogFile(message.author.id);
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${message.author.tag}: ${message.content}\n`;

        try {
          fs.appendFileSync(logFile, line);
        } catch (e) {
          console.error('[dms] Failed to log DM:', e.message);
        }
      }
    });

    console.log('[dms] DM logger initialized (logs to dm-logs/)');
  },

  data: new SlashCommandBuilder()
    .setName('dms')
    .setDescription('DM logging controls (admin)')
    .addSubcommand(sc => sc.setName('status').setDescription('Check DM logging status')),

  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const enabled = interaction.client.isModuleEnabled('dms');
      await interaction.reply({
        content: `DM Logging is currently **${enabled ? 'enabled' : 'disabled'}**.\nLogs are saved in \`dm-logs/\` folder.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
  }
};
