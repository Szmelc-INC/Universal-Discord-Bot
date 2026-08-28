# Interaction Standard

How every module in this bot talks back to Discord: one message per logical
result, edited in place, with buttons/select menus/modals where they add real
value. This document is the spec — read it before writing or editing any
module that replies to an interaction.

Reference material (discord.js v14, "legacy" guide — matches the
`discord.js@^14.26` pinned in `package.json`):

- Modals: <https://discordjs.guide/legacy/interactions/modals>
- Buttons: <https://discordjs.guide/legacy/interactive-components/buttons>
- Select menus: <https://discordjs.guide/legacy/interactive-components/select-menus>
- General interaction handling: <https://discordjs.guide/legacy/interactive-components/interactions>
- Display Components / Components V2: <https://discordjs.guide/legacy/popular-topics/display-components>

The last one describes **Components V2** (`MessageFlags.IsComponentsV2`), a
newer message-shape that replaces `content`/`embeds` with layout builders
(`ContainerBuilder`, `SectionBuilder`, etc.) and forbids mixing them with the
classic fields. This codebase does **not** use Components V2 — every existing
module is built on `content` + `embeds`, and switching would mean rewriting
all of them at once. Classic v1 components (`ActionRowBuilder` +
`ButtonBuilder`/`StringSelectMenuBuilder`/`ModalBuilder`) coexist fine with
`content`/`embeds`/`files` and are what this standard uses throughout. If a
future module wants a pure Components V2 layout, that's fine *for that
module* — just don't mix the two systems in one message payload.

---

## 1. The one rule

**A logical result lives in one message, edited in place — never a stream of
new messages for one user action.**

Concretely:

- A slash command that takes time: `deferReply()` once, then `editReply()`
  with the final result. Never `reply()` after a defer (throws), never
  `followUp()` for what is actually the result (spawns a second message).
- A button/select click on a panel: `interaction.update()` (or
  `deferUpdate()` + `editReply()`), so the click mutates the SAME panel
  message instead of posting a new one.
- A file produced by a slow operation (download, render, export): attach it
  to the edited reply, not a `followUp()`.
- `followUp()` is for things that are genuinely *additional* to an already-
  delivered result: splitting content that exceeds Discord's 2000-char
  message cap (see `ollama.js`'s `/ollama ask` — chunk 1 via `editReply`,
  chunks 2..n via `followUp`, because Discord has no other way to deliver
  >2000 chars), or an ephemeral side-note that shouldn't replace the public
  result.

This is exactly the `/yt mp4|mp3` case named in the original ask: the
downloaded file must land in the same message the user is already looking
at, not a second upload message.

---

## 2. `lib/interactions.js`

Shared helpers every module should use instead of calling
`interaction.reply`/`editReply`/`update` directly. Import what you need:

```js
const {
  customId, parseCustomId,
  reply, panel, updatePanel, notice,
  buttons, selectMenu,
  buildModal, showModal, modalValues,
  bindPanel
} = require('../lib/interactions');
```

It lives at `lib/interactions.js` (repo root), **not** under `modules/` —
`main.js`'s module loader treats every `.js` directly in `modules/` as a
slash command (`{ data, execute }`), so a bare helper file there would fail
to load and print `[FAILED]` on boot. Subdirectories under `modules/` (like
`modules/DISABLED/`) are already skipped by the loader for the same reason;
`lib/` follows that pattern one level up.

### `customId(modName, action, payload?)` / `parseCustomId(id)`

Every button/select/modal customId in this codebase follows
`"modname:action:payload"` — `modname` matches the module's slash command
name (`interaction.commandName` / the file's `data.name`), so the central
router (see §4) knows which module's `handleComponent`/`handleModal` to
call. `payload` is optional and free-form (an index, an id, `"mp3:2"`,
whatever the action needs) — build it with `customId()`, read it back with
`parseCustomId()`.

```js
customId('yt', 'dl', 'mp3:2')   // -> "yt:dl:mp3:2"
parseCustomId('yt:dl:mp3:2')    // -> { modName: 'yt', action: 'dl', payload: 'mp3:2' }
```

Discord caps a customId at 100 characters — keep payloads short (an array
index into a server-side cache, not the raw data).

### `reply(interaction, payload)`

Defer-aware single-message reply: fresh interaction → `reply()`, already
deferred/replied → `editReply()`. Use this everywhere you'd have written
`interaction.reply(...)` or manually checked `interaction.deferred`. This is
also what fixed the pre-existing bug where `client.sendWithLimits` (in
`main.js`) called `interaction.reply()` unconditionally even when the caller
had already deferred (`/yt search` did exactly that) — `sendWithLimits` now
does the same defer-aware check internally.

### `panel(interaction, payload)`

Same as `reply()`, but returns the resulting `Message` so you can keep
editing it later with `Message#edit()` — for a control surface that outlives
the interaction. **Why this matters:** an interaction token (and therefore
`editReply`/`followUp`) expires 15 minutes after the interaction was
created. A `Message` object doesn't expire. `music.js`'s "now playing" panel
is the canonical example — a track can play for hours, long past the
15-minute window, so every update after the first goes through
`state.panelMessage.edit(...)`, not `editReply`. Use `panel()` any time the
thing you're building will still be relevant more than ~10 minutes later
(long-running jobs, persistent control panels, paginated views someone might
come back to).

### `updatePanel(interaction, payload)`

For component (button/select) handlers that should mutate the panel they
were clicked on: `interaction.update()` if fresh, `editReply()` if already
deferred/replied. This is what a button click almost always wants — it acks
the click *and* rewrites the message in the same round trip.

### `notice(interaction, content)`

Ephemeral error/status message that is explicitly **not** the module's
result — "you're not the author of this search", "admin only", etc. Never
use this for the actual answer to a command.

### `buttons(defs)` / `selectMenu(spec)`

Thin builders over `ButtonBuilder`/`ActionRowBuilder` and
`StringSelectMenuBuilder`. See any of `yt.js`, `music.js`, `image.js` for
usage. `buttons()` chunks into rows of 5 automatically (Discord's per-row
cap) up to 5 rows (25-button hard cap per message). `selectMenu()` caps
`options` at 25 (Discord's hard cap on a single select).

### `buildModal(spec)` / `showModal(interaction, spec)` / `modalValues(...)`

See §3.

### `bindPanel(message, handlers)`

Wraps `message.createMessageComponentCollector(...)` for the case where a
module wants a self-contained, message-scoped collector instead of routing
through the central dispatcher (§4) — e.g. a short-lived confirmation flow
that doesn't need to survive a bot restart. `tictactoe.js` predates this
helper and manages its own collector directly (see §5) — either approach is
fine; `bindPanel` just removes the boilerplate when you don't need
game-specific collector logic.

---

## 3. Modals

A modal (`ModalBuilder` + up to 5 `TextInputBuilder` fields wrapped in
`ActionRowBuilder`) is the only way to collect free-text input from a user
without it being a slash-command option. Use it when:

- A slash option would be awkward for long/multi-line text (a DM body, an
  anonymous message, a settings value) — `dm.js` and `anon.js` make the
  `message` option optional and fall back to a modal when it's omitted;
  `settings.js` uses a modal exclusively for its "quick edit" button.
- You want to collect input **after** a button/select click, where there's
  no slash-command option to attach it to at all (`webhooks.js`'s "Edytuj"
  button).

**Hard constraint (Discord API, not a choice we made):** `showModal()` must
be the *first* response to an interaction. You cannot defer first, you
cannot reply first, and a modal submission cannot itself open another
modal. Concretely:

- In a slash command handler: call `showModal()` before any `deferReply()`/
  `reply()` — i.e., as close to the top of `execute()` as the branching
  allows.
- In a button/select handler: call it before any `deferUpdate()`/`update()`/
  `reply()` on that same interaction.

Two valid patterns, pick per case:

**Inline** (`lib`'s `showModal()` helper) — `showModal()` +
`awaitModalSubmit()` in one place, no separate export needed. Simplest when
the whole modal lifecycle fits in one handler and doesn't need to survive a
process restart:

```js
const modalSubmit = await showModal(interaction, {
  id: customId(MODULE, 'editmodal'),
  title: 'Edytuj ustawienie',
  fields: [
    { id: 'key', label: 'Klucz', style: 'short', required: true },
    { id: 'value', label: 'Wartość', style: 'paragraph', required: true }
  ]
});
if (!modalSubmit) return; // timed out (default 5 min) — nothing to clean up

const key = modalSubmit.fields.getTextInputValue('key');
// modalSubmit.update(...) if the modal was opened from a button/select —
// edits the ORIGINAL panel message, not a new one. modalSubmit.reply(...)
// for a modal opened from a slash command (nothing to update yet).
```

See `settings.js` (`handleComponent`, action `edit`) and `webhooks.js`
(`handleComponent`, action `editm`) for the full pattern including error
handling.

**Central** (`handleModal` export) — for a modal whose submission needs to
be routed generically (main.js dispatches any `isModalSubmit()` interaction
whose customId matches `modname:...` to `module.handleModal(interaction)`,
same as it does for components — see §4). Prefer this only when the modal
can legitimately be submitted long after it was shown, or when keeping the
await inline would tangle unrelated control flow. No module currently needs
this — the inline pattern has covered every case so far — but the wiring
exists in `main.js` if one comes up.

---

## 4. Central component/modal routing

`main.js`'s `interactionCreate` handler dispatches every button, select
menu (string/user/role/channel/mentionable), and modal-submit interaction
by parsing its customId with `parseCustomId()` and looking up
`client.commands.get(modName)`:

```js
if (interaction.isModalSubmit() && cmd.handleModal) await cmd.handleModal(interaction);
else if (!interaction.isModalSubmit() && cmd.handleComponent) await cmd.handleComponent(interaction);
```

A module opts in simply by exporting `handleComponent(interaction)` and/or
`handleModal(interaction)` alongside the usual `{ data, execute }`. There is
no registration step — the same dynamic `modules/*.js` discovery that finds
slash commands finds these.

**This only fires for interactions that reach `interactionCreate` at all.**
A module that binds its own `message.createMessageComponentCollector(...)`
(§5) intercepts matching component clicks before they'd otherwise need
central routing — that's a legitimate alternative, not a bug, for
self-contained, message-scoped interactions like a tic-tac-toe board. Use
central routing (`handleComponent`/`handleModal`) for anything that should
keep working across a bot restart or reload, since collectors are in-memory
and die with the process; use a collector for something genuinely scoped to
one ephemeral message exchange.

`client.isModuleEnabled(modName)` is checked before dispatch, same as for
slash commands — a disabled module's buttons silently no-op.

---

## 5. Collectors (`message.createMessageComponentCollector`)

Still the right tool when a component's whole lifecycle is naturally scoped
to one message and doesn't need to survive a restart — `tictactoe.js` is the
reference example (a game board's buttons only matter while that specific
game is being played). Notes learned from that module:

- Prefer `idle` over `time` when the collector should reset its clock on
  every interaction (a game that's still being actively played shouldn't
  time out just because the *total* elapsed time crossed some threshold) —
  use `time` for a true absolute deadline instead (e.g. a one-shot
  confirmation that must be answered within N minutes regardless of
  activity).
- On `'end'`, don't assume the interaction that started the collector is
  still usable — its token may have expired (>15 min). Edit the `Message`
  object directly (`message.edit(...)`), not `interaction.followUp(...)`.
- `collector.stop(reason)` lets `'end'` distinguish *why* it ended (win vs.
  draw vs. idle-timeout) — pass a meaningful reason instead of leaving it
  implicit.

---

## 6. Destructive actions require a confirm step

Anything that deletes/overwrites data without a trivial undo (`/rm`
message purges are the sharpest example) shows a confirm/cancel button pair
*before* doing anything, and the confirmation message becomes the progress
display too (same message throughout — see `shredder.js`). Don't run a
destructive action straight off a slash command's options anymore; gate it
behind an explicit click from the same user who issued the command.

```js
const job = { userId: interaction.user.id, /* ...params */, expiresAt: Date.now() + TTL };
const msg = await panel(interaction, confirmPayload(job));
pending.set(msg.id, job); // keyed by message id, checked + userId-gated in handleComponent
```

---

## 7. Checklist for a new (or updated) module

1. Does any handler call `reply()` after `deferReply()`, or `followUp()` for
   what is actually the result? Fix it — use `reply()`/`panel()` from
   `lib/interactions.js` instead.
2. Does a slow operation (download, external API, render) produce a file or
   final text? It belongs in the same edited message, not a `followUp`.
3. Would a button/select genuinely help — reroll, pagination, pick-from-list,
   confirm/cancel, a persistent control panel? Add it. Not every module
   needs one (`ping.js` doesn't), but check before skipping.
4. Would a modal genuinely help — a slash option that's really "long text
   the user wants to edit comfortably," or input needed after a button
   click with no slash option to attach it to? Add it, respecting the
   first-response constraint from §3.
5. Is the action destructive/irreversible? Add a confirm step (§6).
6. Any customId you introduce follows `modname:action:payload` — build it
   with `customId()`, parse it with `parseCustomId()`.
7. If you add `handleComponent`/`handleModal`, no extra wiring is needed —
   `main.js` finds it automatically once the module is loaded.
8. Long-lived state (a panel that outlives 15 minutes) uses `panel()` +
   `Message#edit()`, not `editReply()`/`followUp()` after the fact.
9. Sanity-check with `node --check modules/yourfile.js` and
   `node -e "require('./modules/yourfile.js')"` before calling it done —
   neither catches Discord-API-shape mistakes, but both catch the syntax
   and require-graph errors that would otherwise only surface at runtime
   against a live bot.

---

## 8. What actually changed, module by module

For orientation when reading the diff this document shipped with:

| Module | What changed |
|---|---|
| `lib/interactions.js` | New — the shared helpers described above |
| `main.js` | `sendWithLimits` made defer-aware (was throwing on `/yt search`); central component/modal routing added to `interactionCreate`; `lib/` cache busted on module reload |
| `yt.js` | `/yt search` now shows a select menu of results + MP3/MP4 buttons; downloaded files land in the same edited message (was `followUp`, a second message) |
| `music.js` | One persistent "now playing" control panel per guild (pause/resume/skip/stop/queue buttons), edited via `Message#edit` — replaces a `followUp` per track/event |
| `help.js` | Command list is now a select menu that shows details in place, with a back button |
| `module-manager.js` | `/modules list` gets a select menu to toggle a module directly (also fixed a pre-existing bug where the "critical module" protection checked the command name `"modules"` instead of the file name `"module-manager"`, leaving it toggleable) |
| `shredder.js` | `/rm` now requires an explicit confirm/cancel click before deleting anything; progress and result reuse the same confirmation message |
| `settings.js` | `/settings list` gets an "Edytuj (modal)" button for quick key/value edits |
| `webhooks.js` | `/webhooks list` gets a select menu → detail view → edit (modal) / delete (confirm) / back, all in one message |
| `image.js`, `joke.js`, `quote.js`, `rng.js`, `crypto.js` | Reroll/refresh button added, editing the same message |
| `dm.js`, `anon.js` | Message text can be composed in a modal when the slash option is left empty |
| `tictactoe.js` | Idle timeout added (collector ran forever otherwise); end-of-game now edits the `Message` directly instead of `interaction.followUp` (which would throw once the 15-minute interaction token expired on a long game); rematch button added |

Everything else was already single-reply and needed no change.
