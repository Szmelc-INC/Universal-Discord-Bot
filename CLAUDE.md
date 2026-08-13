# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                       # deps (Node >=22.12 required by @discordjs/voice)
node main.js                      # interactive menu (pick bot → Start / Enable / Disable module)
node main.js --bot SkyNET         # start a specific bot directly
node main.js --bot SkyNET --debug # verbose discord.js debug/warn/error events
node main.js --bot SkyNET --reload  # wipe all registered slash commands, then re-register
node main.js --bot SkyNET --log     # tee console output to log_<bot>_<ts>.log
node minimal-main.js SkyNET       # stripped-down loader, no config.json/gating (debugging modules)
./setup.sh                        # interactive first-run: npm install, create .env, add bot to config.json
./docker.sh                       # interactive Docker manager (build/up/down/logs/bot selection)
```

There is **no test suite and no linter** — `npm test` prints `no tests`. Verification is manual: start the
bot and check the `=== Module Load Summary ===` block for `Loaded / Skipped / Failed`, or use
`node -c` / `node -e "require('./modules/foo.js')"` to catch syntax and top-level errors in a single module
without connecting to Discord.

`yt-dlp` and `ffmpeg` must be on `PATH` for `/yt` and `/music`.

## Architecture

Single-process discord.js v14 bot, slash-commands only. Everything interesting is in `main.js` (~415 lines)
plus one file per feature in `modules/`.

**Boot path:** `main.js` → read `.env` + `config.json` → `startBot()` builds one `Client` → `loadModules()`
`require`s every `modules/*.js` → commands go into `client.commands` (a `Collection`) → `init(client)` is
called on modules that export it → `clientReady` registers commands over REST → `interactionCreate`
dispatches.

### Module contract

A module is a CommonJS file exporting:

```js
module.exports = {
  data: new SlashCommandBuilder()...,   // REQUIRED — main.js rejects the module without data.name
  async execute(interaction) {},        // slash command handler
  async autocomplete(interaction) {},   // optional, for .setAutocomplete(true) options
  init(client) {}                       // optional, runs once at load: register passive listeners here
};
```

`data` is mandatory even for passive modules — `loadModules()` throws `Module does not export a valid
{ data, execute }` and marks the file **Failed** if `data.name` is missing. See `responses.js` for the
pattern: a passive `messageCreate` listener in `init()` plus a small admin slash command for management.

**Passive listeners must re-check `client.isModuleEnabled('<name>')` inside the handler.** The
`interactionCreate` gate in `main.js` only covers slash commands; a listener registered in `init()` keeps
firing after the module is "disabled" unless it checks for itself. Also note `client.reloadAll()` re-runs
`init()` on every module — listeners registered with `client.on()` accumulate across reloads.

### Injected `client` helpers

`main.js` attaches these to the client; modules use them instead of reimplementing:

- `client.isAdmin(memberOrUser)` — checks `config.admins` (user IDs) and `config.adminRoles` (role IDs).
  Gate every privileged action with it; the convention is an early `reply({ ..., flags: MessageFlags.Ephemeral })`.
- `client.sendWithLimits(interaction, content, options)` — applies `config.limits`
  (`maxMessageLength` / `maxFiles` / `maxFileSize` / `strategy` = `truncate|split|file`).
  **It calls `interaction.reply()` internally**, so it must not be used after `deferReply()`.
  `music`, `shredder` and `webhooks` defer and reply via `editReply`/`followUp`; `ollama` mixes both but
  only calls `sendWithLimits` on non-deferred paths (`/ollama config`). `yt.js:132` is the counter-example —
  it defers at line 122 and then calls `sendWithLimits`, which throws `InteractionAlreadyReplied`. Do not
  copy that call site.
- `client.saveConfig()` — writes the whole in-memory `config` back to `config.json`.
- `client.getAllModuleNames()` / `isModuleEnabled(name)` / `enableModule(name)` / `disableModule(name)`.
- `client.reloadAll()` — re-`require`s modules (cache is busted in `loadModules`), rebuilds
  `client.commands`, wipes and re-registers all slash commands.
- `client.config`, `client.botConfig`, `client.modulesFolder`, `client.configPath`.

### Configuration model

Two files, both JSON, both gitignored-or-sensitive:

- **`.env` is JSON**, not dotenv: `{"BotName": "token", "OtherBot": "token"}`. The set of keys here defines
  which bots exist. Never parse it as KEY=VALUE (this is why `docker.sh` passes `--env-file /dev/null`).
- **`config.json`** — global `admins`, `adminRoles`, `blacklist` (users/roles/guilds, checked first in
  `interactionCreate`), `limits`, free-form `values`, and per-bot `bots.<Name>.{modules_folder,
  enabled_modules, disabled_modules}`.

Module gating is `disabled_modules` first, then: **if `enabled_modules` is non-empty it becomes a strict
whitelist**. This is a trap — `/modules enable foo` pushes `foo` into `enabled_modules`, which silently
disables every other module. Prefer keeping `enabled_modules: []` and managing only `disabled_modules`.

Per-module state lives in `config/*.json` (`reaction-roles.json`, `ollama.json`, `bot-presence.json`,
`incwel-69.json`) and is always resolved as `path.join(__dirname, '..', 'config', ...)` — never relative to
cwd, because Docker runs from a different working directory and mounts `./docker/config` over `/app/config`.
Other runtime dirs follow the same rule: `.downloads/`, `backups/`, `dm-logs/`, `misc/responses.txt`.

`ollama.js` treats its `config/ollama.json` as the sole source of truth and re-reads it from disk (mtime
check) rather than trusting an in-memory copy — follow that pattern for anything users edit by hand.

### Command registration

`registerCommands()` POSTs commands **one at a time** to `Routes.applicationCommands` (global scope, so
propagation is not instant). With `--reload` or via `reloadAll()` it first `PUT`s an empty array to clear
them. `minimal-main.js` does a single bulk `PUT` instead — that is the faster path when iterating locally.

Note `client.once('clientReady', ...)` — the current discord.js event name; `ready` is deprecated.

## Conventions

- Slash-command names come from `data.setName()` and can differ from the filename (`module-manager.js` →
  `/modules`, `shredder.js` → `/rm`, `rich_presence.js` → `/presence`). Module *enable/disable* keys are
  **filenames**, but `interactionCreate` gates on `interaction.commandName` — so a mismatch means the
  `isModuleEnabled` check in the dispatcher looks up a name that does not exist as a file and passes.
- `loadModules()` only reads `*.js` directly inside the modules folder, so moving a file into a subdirectory
  (e.g. `modules/DISABLED/`) parks it out of the loader's reach entirely, independent of `config.json`.
- Admin-only replies use `flags: MessageFlags.Ephemeral`. The deprecated `ephemeral: true` still lingers in
  `incwel-69.js`; use the flag form in new code.
- New modules should be documented in `MODULES.md` (categorised list + per-module usage).
- `main.js` swallows handler errors with a bare `console.error(e)` — an exception after `deferReply()`
  leaves the interaction hanging with no user feedback; handle errors inside `execute`.

## Docker

`docker.sh` is the supported entrypoint; it `sed`s `container_name` and the `--bot` argument permanently
into `docker-compose.yml`, creates `./docker/{logs,downloads,backups,dm-logs,config}`, and — critically —
injects `.env` via `docker cp` **after** the container starts. `.env` must never become a bind mount or
volume: Docker would create it as a directory and `main.js` crashes with `EISDIR`. See the header comment
in `docker.sh` for the full set of design rules.

## Repository

Default branch is **`node`** (not `main`); `origin/main` and `origin/python` hold the older Python version.
`gg/` is an unrelated side project (a GG chatbot knowledge base + standalone HTML client) that happens to
live in this repo — it has its own `gg/README.md` and is not part of the bot.
