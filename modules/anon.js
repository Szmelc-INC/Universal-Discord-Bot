const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { customId, showModal } = require('../lib/interactions');

const MODULE = 'anon';
const ANON_CHANNEL_IDS = [
  '1314503562960834571', // Channel ID 1
  '1314517087414124545'  // Channel ID 2
];

function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Assumes at least one of message/file is truthy — caller guarantees that.
async function sendAnon(client, message, file) {
  const randomId = Math.floor(Math.random() * 9999) + 1;
  const embed = new EmbedBuilder().setDescription(`### 🔏 [ANON-${randomId}] 🔏`);
  const files = [];

  if (file) {
    if (file.contentType && file.contentType.startsWith('image')) {
      embed.addFields({ name: '📬', value: `(${file.url})`, inline: false });
      embed.setImage(file.url);
    } else {
      files.push({ attachment: file.url, name: file.name });
      embed.addFields({ name: '📦', value: `[${file.name}](${file.url})`, inline: false });
    }
  }

  if (message) {
    embed.addFields({ name: isValidUrl(message) ? '📷' : '💬', value: message, inline: false });
  }

  for (const channelId of ANON_CHANNEL_IDS) {
    const channel = client.channels.cache.get(channelId);
    if (channel) await channel.send({ embeds: [embed], files });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anon')
    .setDescription('Send an anonymous message, file, or link to specified channels.')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Message or URL to send')
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName('file')
        .setDescription('File or image to send')
        .setRequired(false)
    ),
  async execute(interaction) {
    const message = interaction.options.getString('message');
    const file = interaction.options.getAttachment('file');

    if (message || file) {
      await sendAnon(interaction.client, message, file);
      await interaction.reply({ content: 'Sent anonymously!', flags: MessageFlags.Ephemeral });
      return;
    }

    // Neither option given: compose the text in a modal instead of erroring
    // out. showModal() must be the FIRST response to this interaction —
    // execute() hasn't replied yet at this point, so this is valid.
    const modalSubmit = await showModal(interaction, {
      id: customId(MODULE, 'compose'),
      title: 'Anonimowa wiadomość',
      fields: [{ id: 'message', label: 'Treść (tekst lub URL)', style: 'paragraph', required: true, maxLength: 2000 }]
    });
    if (!modalSubmit) return; // timed out

    const text = modalSubmit.fields.getTextInputValue('message');
    await sendAnon(interaction.client, text, null);
    await modalSubmit.reply({ content: 'Sent anonymously!', flags: MessageFlags.Ephemeral });
  }
};
