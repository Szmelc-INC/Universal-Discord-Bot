const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { exec, execFile } = require('child_process');
const { customId, parseCustomId, notice, selectMenu, showModal } = require('../lib/interactions');

const MODULE = 'shell';
const allowed = {
  figlet: ['figlet'],
  toilet: ['toilet'],
  cowsay: ['cowsay'],
  fortune: ['fortune'],
  uptime: ['uptime']
};
// Whitelisted commands that take free-text input — offered via a modal after
// picking the command, since the base binary is already fixed by then (see
// handleComponent below and INTERACTIONS.md §3/§7).
const NEEDS_ARG = new Set(['figlet', 'toilet', 'cowsay']);

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

function codeBlock(output) {
  return '​```\n' + output + '\n```';
}

// For interactions that must land via update()/editReply() on a specific
// existing message (component/modal flows) rather than sendWithLimits'
// reply-or-split machinery, which assumes it owns a fresh interaction.
function truncated(output, max = 1900) {
  const block = codeBlock(output);
  return block.length <= max + 8 ? block : codeBlock(output.slice(0, max) + '\n…(truncated)');
}

function whitelistRow() {
  return [selectMenu({
    id: customId(MODULE, 'pickcmd'),
    placeholder: 'Wybierz bezpieczną komendę…',
    options: Object.keys(allowed).map(name => ({
      label: name,
      description: NEEDS_ARG.has(name) ? 'poprosi o tekst w modalu' : 'bez argumentów',
      value: name
    }))
  })];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shell')
    .setDescription('Execute shell commands — admins get full access, others are limited to safe commands')
    .addStringOption(o =>
      o.setName('command')
        .setDescription('Full command to run — leave empty for a modal (admin) or a safe command picker')
        .setRequired(false)
    ),
  async execute(interaction) {
    const isAdminUser = interaction.client.isAdmin(interaction.member || interaction.user);
    const full = interaction.options.getString('command');

    if (!full) {
      if (isAdminUser) {
        // showModal() must be the FIRST response to this interaction —
        // execute() hasn't replied yet at this point, so this is valid.
        const modalSubmit = await showModal(interaction, {
          id: customId(MODULE, 'admincmd'),
          title: 'Uruchom komendę (admin)',
          fields: [{ id: 'cmd', label: 'Pełna komenda', style: 'paragraph', required: true, maxLength: 1000 }]
        });
        if (!modalSubmit) return; // timed out
        await modalSubmit.deferReply();
        const output = await run(modalSubmit.fields.getTextInputValue('cmd').trim());
        await modalSubmit.client.sendWithLimits(modalSubmit, codeBlock(output));
        return;
      }

      // Non-admin, no command typed: a free-text modal here would let
      // non-admins type arbitrary shell syntax and defeat the whitelist —
      // a select menu keeps them scoped to execFile'd, fixed binaries.
      await interaction.reply({
        content: 'Wybierz bezpieczną komendę do uruchomienia:',
        components: whitelistRow(),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const parts = full.trim().split(/\s+/);
    const base = parts[0];
    const args = parts.slice(1);

    if (!isAdminUser) {
      if (!allowed[base]) {
        await interaction.reply({ content: 'You are not allowed to run this command. Available: ' + Object.keys(allowed).join(', '), flags: MessageFlags.Ephemeral });
        return;
      }
      const output = await runFile(allowed[base][0], args);
      await interaction.client.sendWithLimits(interaction, codeBlock(output));
      return;
    }

    // Admin: full power
    const output = await run(full);
    await interaction.client.sendWithLimits(interaction, codeBlock(output));
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "shell:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { action } = parseCustomId(interaction.customId);
    if (action !== 'pickcmd') return;

    const base = interaction.values[0];
    if (!allowed[base]) {
      await notice(interaction, 'Nieznana komenda.');
      return;
    }

    if (!NEEDS_ARG.has(base)) {
      await interaction.deferUpdate();
      const output = await runFile(allowed[base][0], []);
      await interaction.editReply({ content: truncated(output), components: [] });
      return;
    }

    // Needs a text argument: collect it via a modal. The base binary is
    // already fixed to a whitelisted one — execFile never touches a shell,
    // so whatever the user types here can only ever become an argument to
    // that fixed binary, not arbitrary shell syntax.
    const modalSubmit = await showModal(interaction, {
      id: customId(MODULE, 'argmodal', base),
      title: `Argument dla: ${base}`.slice(0, 45),
      fields: [{ id: 'arg', label: 'Tekst', style: 'short', required: true, maxLength: 200 }]
    });
    if (!modalSubmit) return; // timed out

    const arg = modalSubmit.fields.getTextInputValue('arg');
    const output = await runFile(allowed[base][0], [arg]);
    // update() edits the message the modal's source select menu was
    // attached to — valid because the modal originated from a component,
    // per the Discord API (see INTERACTIONS.md §3).
    await modalSubmit.update({ content: truncated(output), components: [] });
  }
};
