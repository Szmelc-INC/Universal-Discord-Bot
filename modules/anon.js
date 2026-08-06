const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

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
      if (isValidUrl(message)) {
        embed.addFields({ name: '📷', value: message, inline: false });
      } else {
        embed.addFields({ name: '💬', value: message, inline: false });
      }
    }

    if (embed.data.fields && embed.data.fields.length) {
      for (const channelId of ANON_CHANNEL_IDS) {
        const channel = interaction.client.channels.cache.get(channelId);
        if (channel) {
          await channel.send({ embeds: [embed], files });
        }
      }
      await interaction.reply({ content: 'Sent anonymously!', flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: 'You must provide a message or attach a file/image to send.', flags: MessageFlags.Ephemeral });
    }
  }
};
