'use strict';
/**
 * Standard interaction helpers — shared by every module.
 * See INTERACTIONS.md at repo root for the full spec, rationale and examples.
 *
 * This file lives outside modules/ on purpose: main.js's loadModules() treats
 * every *.js directly under modules/ as a slash command and requires
 * { data, execute } — a bare helper file there would print [FAILED] on boot.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require('discord.js');

const NS_SEP = ':';

/**
 * Build a namespaced customId: "modname:action:payload".
 * payload is optional and may itself contain ':' (only the first two
 * separators are significant — parseCustomId only splits twice).
 */
function customId(modName, action, payload) {
  const base = `${modName}${NS_SEP}${action}`;
  return payload === undefined || payload === null || payload === ''
    ? base
    : `${base}${NS_SEP}${payload}`;
}

/** Split a customId built with customId() back into its parts. */
function parseCustomId(id) {
  const [modName, action, ...rest] = String(id).split(NS_SEP);
  return { modName, action, payload: rest.join(NS_SEP) };
}

/**
 * Defer-aware single-message reply. Use this instead of interaction.reply /
 * interaction.editReply directly — it always lands in the SAME message:
 *   - fresh interaction        -> reply()
 *   - deferred or already-replied -> editReply()
 * This is the fix for the classic bug where a module calls deferReply() and
 * then still calls reply() (throws), or answers a slow op with followUp()
 * (spawns a second message instead of updating the first).
 */
async function reply(interaction, payload) {
  const data = typeof payload === 'string' ? { content: payload } : payload;
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(data);
  }
  return interaction.reply(data);
}

/**
 * Same as reply(), but returns the resulting Message object (fetches it if
 * needed) so callers can .edit() it later — e.g. a long-lived player/help
 * panel that outlives the 15-minute interaction token. Once that window
 * closes, only Message#edit works; editReply/followUp will throw.
 */
async function panel(interaction, payload) {
  const data = typeof payload === 'string' ? { content: payload } : payload;
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(data);
  }
  await interaction.reply(data);
  return interaction.fetchReply();
}

/**
 * Button-or-select component interactions: update the panel in place instead
 * of sending a new message. Prefer this over reply() inside a component/
 * modal handler whenever the click should just mutate the existing panel.
 */
async function updatePanel(interaction, payload) {
  const data = typeof payload === 'string' ? { content: payload } : payload;
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(data);
  }
  return interaction.update(data);
}

/** Ephemeral error/notice shortcut — never used for the module's actual result. */
async function notice(interaction, content) {
  const data = { content, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(data);
  }
  return interaction.reply(data);
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  link: ButtonStyle.Link
};

/**
 * buttons([{ id, label, style, emoji, disabled, url }, ...]) -> ActionRowBuilder[]
 * `id` becomes the raw customId (build it with customId() yourself), or omit
 * it and pass `url` for a Link-style button. Chunks into rows of 5 (Discord's
 * per-row cap) and returns up to 5 rows (25-button hard cap per message).
 */
function buttons(defs) {
  const built = defs.map(d => {
    const b = new ButtonBuilder().setLabel(d.label).setStyle(BUTTON_STYLES[d.style || 'secondary']);
    if (d.url) b.setStyle(ButtonStyle.Link).setURL(d.url);
    else b.setCustomId(d.id);
    if (d.emoji) b.setEmoji(d.emoji);
    if (d.disabled) b.setDisabled(true);
    return b;
  });
  const rows = [];
  for (let i = 0; i < built.length && rows.length < 5; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(built.slice(i, i + 5)));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Select menus
// ---------------------------------------------------------------------------

/**
 * selectMenu({ id, placeholder, minValues, maxValues, options }) -> ActionRowBuilder
 * options: [{ label, value, description, emoji, default }, ...] (max 25)
 */
function selectMenu({ id, placeholder, minValues, maxValues, options }) {
  const menu = new StringSelectMenuBuilder().setCustomId(id);
  if (placeholder) menu.setPlaceholder(placeholder);
  if (minValues != null) menu.setMinValues(minValues);
  if (maxValues != null) menu.setMaxValues(maxValues);
  menu.addOptions(options.slice(0, 25).map(o => {
    const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value);
    if (o.description) opt.setDescription(o.description);
    if (o.emoji) opt.setEmoji(o.emoji);
    if (o.default) opt.setDefault(true);
    return opt;
  }));
  return new ActionRowBuilder().addComponents(menu);
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

const TEXT_INPUT_STYLES = { short: TextInputStyle.Short, paragraph: TextInputStyle.Paragraph };

/**
 * buildModal({ id, title, fields: [{ id, label, style, required, minLength,
 *   maxLength, placeholder, value }] }) -> ModalBuilder
 * Max 5 fields (Discord's hard cap on a v1 modal).
 */
function buildModal({ id, title, fields }) {
  const modal = new ModalBuilder().setCustomId(id).setTitle(title);
  for (const f of fields.slice(0, 5)) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label)
      .setStyle(TEXT_INPUT_STYLES[f.style || 'short'])
      .setRequired(f.required !== false);
    if (f.minLength != null) input.setMinLength(f.minLength);
    if (f.maxLength != null) input.setMaxLength(f.maxLength);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    if (f.value) input.setValue(f.value);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

/**
 * showModal(interaction, spec) — spec is the buildModal() argument shape.
 *
 * HARD CONSTRAINT (Discord API, not this lib): showModal() must be the FIRST
 * response to an interaction. Never call this after reply()/deferReply()/
 * another showModal() on the same interaction — it will throw. This means:
 * command handlers that want a modal must call showModal() as their very
 * first action, before any await that could race a defer.
 *
 * Returns the ModalSubmitInteraction, or null on timeout (default 5 min).
 * The caller is responsible for responding to THAT interaction (reply/
 * editReply/update/deferUpdate) — showModal() only shows the form.
 */
async function showModal(interaction, spec, { time = 5 * 60_000 } = {}) {
  await interaction.showModal(buildModal(spec));
  try {
    return await interaction.awaitModalSubmit({
      time,
      filter: i => i.customId === spec.id && i.user.id === interaction.user.id
    });
  } catch {
    return null;
  }
}

/** Read all text field values off a ModalSubmitInteraction as {fieldId: value}. */
function modalValues(modalInteraction, fieldIds) {
  const out = {};
  for (const id of fieldIds) out[id] = modalInteraction.fields.getTextInputValue(id);
  return out;
}

// ---------------------------------------------------------------------------
// Component collectors bound to a panel message
// ---------------------------------------------------------------------------

/**
 * bindPanel(message, { time, idle, filter, onButton, onSelect, onEnd }) ->
 * MessageComponentCollector
 *
 * Standard way to make a panel message (returned by panel()) interactive.
 * Handlers receive the raw component interaction; call updatePanel() inside
 * them to mutate the SAME message. On expiry, components are stripped
 * automatically (best-effort, message may already be deleted) unless
 * `onEnd` is provided to do something custom (e.g. show a "session expired"
 * state instead of removing buttons).
 */
function bindPanel(message, { time = 10 * 60_000, idle, filter, onButton, onSelect, onEnd } = {}) {
  const collector = message.createMessageComponentCollector({ time, idle, filter });

  collector.on('collect', async i => {
    try {
      if (i.isButton() && onButton) await onButton(i);
      else if (i.isStringSelectMenu() && onSelect) await onSelect(i);
    } catch (e) {
      console.error(`[interactions] panel handler error (${i.customId}):`, e.message);
    }
  });

  collector.on('end', async collected => {
    if (onEnd) {
      try { await onEnd(collected); } catch { /* message may be gone */ }
      return;
    }
    try { await message.edit({ components: [] }); } catch { /* message may be gone */ }
  });

  return collector;
}

module.exports = {
  customId,
  parseCustomId,
  reply,
  panel,
  updatePanel,
  notice,
  buttons,
  selectMenu,
  buildModal,
  showModal,
  modalValues,
  bindPanel
};
