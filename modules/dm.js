const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { customId, showModal } = require('../lib/interactions');

const MODULE = 'dm';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a direct message as the bot')
    .addUserOption(o => o.setName('user').setDescription('User to DM').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message content — leave empty to compose in a modal').setRequired(false)),
  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Unauthorized.', flags: MessageFlags.Ephemeral });
      return;
    }
    const user = interaction.options.getUser('user');
    const inline = interaction.options.getString('message');

    if (inline) {
      try {
        await user.send(inline);
        await interaction.reply(`Message sent to ${user.tag}`);
      } catch (e) {
        await interaction.reply(`Failed to send DM: ${e.message || e}`);
      }
      return;
    }

    // No message option given: compose it in a modal (longer text, real newlines).
    // showModal() must be the FIRST response to this interaction — execute()
    // hasn't replied yet at this point, so this is valid.
    const modalSubmit = await showModal(interaction, {
      id: customId(MODULE, 'compose'),
      title: `DM do ${user.tag}`.slice(0, 45),
      fields: [{ id: 'message', label: 'Treść wiadomości', style: 'paragraph', required: true, maxLength: 2000 }]
    });
    if (!modalSubmit) return; // timed out

    const text = modalSubmit.fields.getTextInputValue('message');
    try {
      await user.send(text);
      await modalSubmit.reply({ content: `Message sent to ${user.tag}`, flags: MessageFlags.Ephemeral });
    } catch (e) {
      await modalSubmit.reply({ content: `Failed to send DM: ${e.message || e}`, flags: MessageFlags.Ephemeral });
    }
  }
};
