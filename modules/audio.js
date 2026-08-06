const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('audio')
    .setDescription('Audio related commands (legacy)')
    .addSubcommand(sc =>
      sc.setName('music').setDescription('Use the new /music commands instead')
    ),
  async execute(interaction) {
    await interaction.reply({
      content: 'Voice music has moved to the dedicated `/music` command. Try `/music join` and `/music play`.',
      flags: MessageFlags.Ephemeral
    });
  }
};

