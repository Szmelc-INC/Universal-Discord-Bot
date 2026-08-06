const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const REACTION_CONFIG = path.join(__dirname, '..', 'config', 'reaction-roles.json');

function loadReactionConfig() {
  try {
    if (!fs.existsSync(REACTION_CONFIG)) {
      // Create default config file on first run
      const defaultConfig = {
        enabled: false,
        messageId: "123456789012345678",
        guildId: "YOUR_GUILD_ID_HERE",
        mappings: {
          "👀": "Role Name Here",
          "👍": "Another Role"
        }
      };
      fs.mkdirSync(path.dirname(REACTION_CONFIG), { recursive: true });
      fs.writeFileSync(REACTION_CONFIG, JSON.stringify(defaultConfig, null, 2));
      console.log('[reaction] Created default reaction-roles.json. Please configure it.');
      return defaultConfig;
    }
    return JSON.parse(fs.readFileSync(REACTION_CONFIG, 'utf8'));
  } catch (e) {
    console.error('[reaction] Failed to load reaction config:', e.message);
    return { enabled: false, mappings: {} };
  }
}

let reactionConfig = { enabled: false, mappings: {} };

module.exports = {
  init(client) {
    reactionConfig = loadReactionConfig();

    if (!reactionConfig.enabled) {
      console.log('[reaction] Reaction roles disabled in config.');
      return;
    }

    client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      if (!client.isModuleEnabled('reaction')) return;

      await handleReaction(reaction, user, 'add', client);
    });

    client.on('messageReactionRemove', async (reaction, user) => {
      if (user.bot) return;
      if (!client.isModuleEnabled('reaction')) return;

      await handleReaction(reaction, user, 'remove', client);
    });

    console.log('[reaction] Reaction role listener initialized');
  },

  data: new SlashCommandBuilder()
    .setName('reaction')
    .setDescription('Reaction roles management (admin)')
    .addSubcommand(sc => sc.setName('reload').setDescription('Reload reaction role config'))
    .addSubcommand(sc => sc.setName('status').setDescription('Show current reaction role config')),

  async execute(interaction) {
    if (!interaction.client.isAdmin(interaction.member || interaction.user)) {
      await interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'reload') {
      reactionConfig = loadReactionConfig();
      await interaction.reply({ content: 'Reaction roles config reloaded.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'status') {
      const status = reactionConfig.enabled ? '✅ Enabled' : '❌ Disabled';
      const count = Object.keys(reactionConfig.mappings || {}).length;
      await interaction.reply({
        content: `**Reaction Roles Status**\n${status}\nMessage ID: \`${reactionConfig.messageId}\`\nMappings: ${count}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
  }
};

async function handleReaction(reaction, user, action, client) {
  try {
    // Fetch partial reactions
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const cfg = reactionConfig;
    if (!cfg.enabled || reaction.message.id !== cfg.messageId) return;

    const emoji = reaction.emoji.name || reaction.emoji.id;
    const roleName = cfg.mappings?.[emoji];
    if (!roleName) return;

    const guild = reaction.message.guild;
    if (!guild) return;

    const role = guild.roles.cache.find(r => r.name === roleName);
    if (!role) {
      console.warn(`[reaction] Role "${roleName}" not found`);
      return;
    }

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    if (action === 'add') {
      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role);
      }
    } else {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
      }
    }
  } catch (e) {
    console.error('[reaction] Error handling reaction:', e.message);
  }
}
