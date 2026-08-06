const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Display detailed information about users or the server')
    .addSubcommand(sub =>
      sub.setName('user')
        .setDescription('Show detailed information about a user')
        .addUserOption(opt =>
          opt.setName('target')
            .setDescription('The user to get info about (defaults to yourself)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('server')
        .setDescription('Show detailed information about this server')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'user') {
      await handleUserInfo(interaction);
    } else if (sub === 'server') {
      await handleServerInfo(interaction);
    }
  }
};

async function handleUserInfo(interaction) {
  const target = interaction.options.getUser('target') || interaction.user;
  const member = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`${target.tag} ${target.bot ? '🤖' : ''}`)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `ID: ${target.id}` })
    .setTimestamp();

  // Basic Account Info
  embed.addFields({
    name: '📋 Account',
    value: [
      `**Created:** <t:${Math.floor(target.createdTimestamp / 1000)}:R>`,
      `**Username:** \`${target.username}\``,
      target.discriminator !== '0' ? `**Discriminator:** \`#${target.discriminator}\`` : '',
      `**Bot:** ${target.bot ? 'Yes' : 'No'}`
    ].filter(Boolean).join('\n'),
    inline: true
  });

  // Server-specific info
  if (member) {
    const joinTimestamp = member.joinedTimestamp;
    const roles = member.roles.cache
      .filter(r => r.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => r.toString());

    const roleDisplay = roles.length > 0
      ? roles.slice(0, 10).join(', ') + (roles.length > 10 ? ` (+${roles.length - 10} more)` : '')
      : 'No roles';

    embed.addFields({
      name: '🏠 Server Member',
      value: [
        `**Joined:** <t:${Math.floor(joinTimestamp / 1000)}:R>`,
        `**Nickname:** ${member.nickname ? `\`${member.nickname}\`` : 'None'}`,
        `**Roles:** ${roles.length} total`
      ].join('\n'),
      inline: true
    });

    embed.addFields({
      name: `🎭 Roles (${roles.length})`,
      value: roleDisplay.length > 1024 ? roleDisplay.slice(0, 1021) + '...' : roleDisplay,
      inline: false
    });

    // Permissions (only show important ones or for admins)
    const perms = member.permissions;
    const keyPerms = [];

    if (perms.has('Administrator')) keyPerms.push('Administrator');
    if (perms.has('ManageGuild')) keyPerms.push('Manage Server');
    if (perms.has('ManageMessages')) keyPerms.push('Manage Messages');
    if (perms.has('ManageRoles')) keyPerms.push('Manage Roles');
    if (perms.has('KickMembers')) keyPerms.push('Kick Members');
    if (perms.has('BanMembers')) keyPerms.push('Ban Members');
    if (perms.has('ModerateMembers')) keyPerms.push('Timeout Members');

    if (keyPerms.length > 0) {
      embed.addFields({
        name: '🔑 Key Permissions',
        value: keyPerms.join(', '),
        inline: true
      });
    }

    // Boost status
    if (member.premiumSince) {
      embed.addFields({
        name: '💎 Server Boosting',
        value: `Since <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`,
        inline: true
      });
    }
  }

  // User Flags / Badges
  const flags = target.flags?.toArray() || [];
  const badgeMap = {
    Staff: 'Discord Staff',
    Partner: 'Partnered Server Owner',
    Hypesquad: 'HypeSquad Events',
    BugHunterLevel1: 'Bug Hunter',
    BugHunterLevel2: 'Bug Hunter (Level 2)',
    HypeSquadOnlineHouse1: 'House Bravery',
    HypeSquadOnlineHouse2: 'House Brilliance',
    HypeSquadOnlineHouse3: 'House Balance',
    PremiumEarlySupporter: 'Early Supporter',
    TeamPseudoUser: 'Team User',
    VerifiedBot: 'Verified Bot',
    VerifiedDeveloper: 'Verified Bot Developer',
    CertifiedModerator: 'Certified Moderator',
    ActiveDeveloper: 'Active Developer'
  };

  const badges = flags
    .map(f => badgeMap[f] || f)
    .filter(Boolean);

  if (badges.length > 0) {
    embed.addFields({
      name: '🏅 Badges',
      value: badges.join(', '),
      inline: false
    });
  }

  // Avatar links
  embed.addFields({
    name: '🖼️ Avatar Links',
    value: [
      `[PNG](${target.displayAvatarURL({ size: 1024, extension: 'png' })})`,
      `[JPG](${target.displayAvatarURL({ size: 1024, extension: 'jpg' })})`,
      `[WEBP](${target.displayAvatarURL({ size: 1024, extension: 'webp' })})`
    ].join(' • '),
    inline: false
  });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleServerInfo(interaction) {
  const guild = interaction.guild;

  if (!guild) {
    return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
  }

  // Ensure we have fresh data
  const freshGuild = await guild.fetch();

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle(freshGuild.name)
    .setThumbnail(freshGuild.iconURL({ size: 256 }))
    .setFooter({ text: `Server ID: ${freshGuild.id}` })
    .setTimestamp();

  // Basic Info
  embed.addFields({
    name: '📋 Basic Information',
    value: [
      `**Owner:** <@${freshGuild.ownerId}>`,
      `**Created:** <t:${Math.floor(freshGuild.createdTimestamp / 1000)}:R>`,
      `**Description:** ${freshGuild.description || 'No description'}`
    ].join('\n'),
    inline: false
  });

  // Member Stats
  const totalMembers = freshGuild.memberCount;
  const bots = freshGuild.members.cache.filter(m => m.user.bot).size;
  const humans = totalMembers - bots;

  embed.addFields({
    name: '👥 Members',
    value: [
      `**Total:** ${totalMembers}`,
      `**Humans:** ${humans}`,
      `**Bots:** ${bots}`
    ].join('\n'),
    inline: true
  });

  // Boost Status
  embed.addFields({
    name: '💎 Boost Status',
    value: [
      `**Level:** ${freshGuild.premiumTier}`,
      `**Boosts:** ${freshGuild.premiumSubscriptionCount || 0}`
    ].join('\n'),
    inline: true
  });

  // Channels
  const channels = freshGuild.channels.cache;
  const textChannels = channels.filter(c => c.type === 0).size;
  const voiceChannels = channels.filter(c => c.type === 2).size;
  const categories = channels.filter(c => c.type === 4).size;
  const threads = channels.filter(c => [10, 11, 12].includes(c.type)).size;

  embed.addFields({
    name: '📺 Channels',
    value: [
      `**Text:** ${textChannels}`,
      `**Voice:** ${voiceChannels}`,
      `**Categories:** ${categories}`,
      `**Threads:** ${threads}`,
      `**Total:** ${channels.size}`
    ].join('\n'),
    inline: true
  });

  // Roles & Emojis
  embed.addFields({
    name: '🎭 Roles & Emojis',
    value: [
      `**Roles:** ${freshGuild.roles.cache.size}`,
      `**Emojis:** ${freshGuild.emojis.cache.size}`,
      `**Stickers:** ${freshGuild.stickers.cache.size}`
    ].join('\n'),
    inline: true
  });

  // Features
  const features = freshGuild.features;
  if (features.length > 0) {
    const niceFeatures = features
      .map(f => f.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase()))
      .sort();

    embed.addFields({
      name: `✨ Server Features (${features.length})`,
      value: niceFeatures.join(', '),
      inline: false
    });
  }

  // Vanity & Verification
  const verificationLevels = {
    0: 'None',
    1: 'Low',
    2: 'Medium',
    3: 'High',
    4: 'Very High'
  };

  embed.addFields({
    name: '🔒 Security',
    value: [
      `**Verification Level:** ${verificationLevels[freshGuild.verificationLevel] || 'Unknown'}`,
      `**Vanity URL:** ${freshGuild.vanityURLCode ? `discord.gg/${freshGuild.vanityURLCode}` : 'None'}`
    ].join('\n'),
    inline: true
  });

  // Banner / Splash
  if (freshGuild.banner) {
    embed.setImage(freshGuild.bannerURL({ size: 1024 }));
    embed.addFields({
      name: '🖼️ Assets',
      value: `[Banner](${freshGuild.bannerURL({ size: 1024 })})`,
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
