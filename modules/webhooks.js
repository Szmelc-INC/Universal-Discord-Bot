const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('webhooks')
    .setDescription('Manage webhooks in this server (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks)
    .addSubcommand(sc =>
      sc.setName('list')
        .setDescription('List all webhooks in this server')
    )
    .addSubcommand(sc =>
      sc.setName('create')
        .setDescription('Create a new webhook')
        .addStringOption(o =>
          o.setName('name')
            .setDescription('Name of the webhook')
            .setRequired(true)
            .setMaxLength(80)
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Channel where the webhook will be created')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('avatar')
            .setDescription('Avatar URL for the webhook (optional)')
            .setRequired(false)
        )
    )
    .addSubcommand(sc =>
      sc.setName('delete')
        .setDescription('Delete an existing webhook')
        .addStringOption(o =>
          o.setName('webhook')
            .setDescription('Select the webhook to delete')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName('edit')
        .setDescription('Edit an existing webhook')
        .addStringOption(o =>
          o.setName('webhook')
            .setDescription('Webhook to edit')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(o =>
          o.setName('name')
            .setDescription('New name (optional)')
            .setRequired(false)
            .setMaxLength(80)
        )
        .addStringOption(o =>
          o.setName('avatar')
            .setDescription('New avatar URL (optional)')
            .setRequired(false)
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Move webhook to another channel (optional)')
            .setRequired(false)
        )
    )
    .addSubcommand(sc =>
      sc.setName('info')
        .setDescription('Show details and URL of a webhook (ephemeral)')
        .addStringOption(o =>
          o.setName('webhook')
            .setDescription('Select the webhook')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const guild = interaction.guild;

    if (!guild) return;

    try {
      const webhooks = await guild.fetchWebhooks();
      const filtered = webhooks
        .filter(w => w.name.toLowerCase().includes(focused.toLowerCase()))
        .map(w => ({
          name: `${w.name} (#${w.channel?.name || 'unknown'})`,
          value: w.id
        }))
        .slice(0, 25);

      await interaction.respond(filtered);
    } catch (err) {
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      return interaction.reply({
        content: 'You do not have permission to manage webhooks.',
        flags: MessageFlags.Ephemeral
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }

    try {
      switch (subcommand) {
        case 'list':
          await this.listWebhooks(interaction, guild);
          break;
        case 'create':
          await this.createWebhook(interaction, guild);
          break;
        case 'delete':
          await this.deleteWebhook(interaction, guild);
          break;
        case 'edit':
          await this.editWebhook(interaction, guild);
          break;
        case 'info':
          await this.showWebhookInfo(interaction, guild);
          break;
      }
    } catch (error) {
      console.error('[webhooks]', error);
      const replyMethod = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
      await interaction[replyMethod]({
        content: `An error occurred: ${error.message}`,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  },

  async listWebhooks(interaction, guild) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const webhooks = await guild.fetchWebhooks();

    if (webhooks.size === 0) {
      return interaction.editReply('No webhooks found in this server.');
    }

    const embed = new EmbedBuilder()
      .setTitle(`Webhooks in ${guild.name}`)
      .setColor(0x5865F2)
      .setFooter({ text: `${webhooks.size} total webhooks` });

    const lines = [];
    for (const [id, webhook] of webhooks) {
      const channel = webhook.channel ? `<#${webhook.channel.id}>` : 'Unknown channel';
      const creator = webhook.owner ? `${webhook.owner.tag}` : 'Unknown';
      lines.push(`**${webhook.name}** — ${channel}\nCreator: ${creator} • ID: \`${id}\``);
    }

    embed.setDescription(lines.join('\n\n'));

    await interaction.editReply({ embeds: [embed] });
  },

  async createWebhook(interaction, guild) {
    const name = interaction.options.getString('name');
    const channel = interaction.options.getChannel('channel');
    const avatarUrl = interaction.options.getString('avatar');

    if (!channel || !['GUILD_TEXT', 'GUILD_ANNOUNCEMENT'].includes(channel.type)) {
      return interaction.reply({
        content: 'Please select a text channel.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const webhookOptions = {
      name,
      avatar: avatarUrl || null
    };

    const webhook = await channel.createWebhook(webhookOptions);

    const embed = new EmbedBuilder()
      .setTitle('Webhook Created Successfully')
      .setColor(0x57F287)
      .addFields(
        { name: 'Name', value: webhook.name, inline: true },
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'ID', value: `\`${webhook.id}\``, inline: true }
      )
      .setDescription(
        '⚠️ **Webhook URL (only visible to you):**\n' +
        '```\n' + webhook.url + '\n```\n' +
        'Copy this URL and use it to send messages as this webhook.'
      );

    if (webhook.avatar) {
      embed.setThumbnail(webhook.avatarURL());
    }

    await interaction.editReply({ embeds: [embed] });
  },

  async deleteWebhook(interaction, guild) {
    const webhookId = interaction.options.getString('webhook');

    const webhooks = await guild.fetchWebhooks();
    const webhook = webhooks.get(webhookId);

    if (!webhook) {
      return interaction.reply({
        content: 'Webhook not found or already deleted.',
        flags: MessageFlags.Ephemeral
      });
    }

    await webhook.delete(`Deleted by ${interaction.user.tag}`);
    await interaction.reply({
      content: `Webhook **${webhook.name}** has been deleted.`,
      flags: MessageFlags.Ephemeral
    });
  },

  async editWebhook(interaction, guild) {
    const webhookId = interaction.options.getString('webhook');
    const newName = interaction.options.getString('name');
    const newAvatar = interaction.options.getString('avatar');
    const newChannel = interaction.options.getChannel('channel');

    const webhooks = await guild.fetchWebhooks();
    const webhook = webhooks.get(webhookId);

    if (!webhook) {
      return interaction.reply({
        content: 'Webhook not found.',
        flags: MessageFlags.Ephemeral
      });
    }

    const editOptions = {};

    if (newName) editOptions.name = newName;
    if (newAvatar) editOptions.avatar = newAvatar;
    if (newChannel) editOptions.channel = newChannel.id;

    if (Object.keys(editOptions).length === 0) {
      return interaction.reply({
        content: 'You must provide at least one field to edit.',
        flags: MessageFlags.Ephemeral
      });
    }

    const updated = await webhook.edit(editOptions);

    const embed = new EmbedBuilder()
      .setTitle('Webhook Updated')
      .setColor(0xFEE75C)
      .addFields(
        { name: 'Name', value: updated.name },
        { name: 'Channel', value: updated.channel ? `<#${updated.channel.id}>` : 'Unknown' }
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  async showWebhookInfo(interaction, guild) {
    const webhookId = interaction.options.getString('webhook');

    const webhooks = await guild.fetchWebhooks();
    const webhook = webhooks.get(webhookId);

    if (!webhook) {
      return interaction.reply({
        content: 'Webhook not found.',
        flags: MessageFlags.Ephemeral
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Webhook: ${webhook.name}`)
      .setColor(0x5865F2)
      .addFields(
        { name: 'ID', value: `\`${webhook.id}\``, inline: true },
        { name: 'Channel', value: webhook.channel ? `<#${webhook.channel.id}>` : 'Unknown', inline: true },
        { name: 'Created by', value: webhook.owner ? webhook.owner.tag : 'Unknown', inline: true },
        { name: 'Webhook URL', value: '```\n' + webhook.url + '\n```' }
      );

    if (webhook.avatar) {
      embed.setThumbnail(webhook.avatarURL());
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
