# Universal Discord Bot — Modules Documentation

This document provides a complete overview and usage guide for all modules available in the **Universal Discord Bot**.

## Overview

The bot is designed around a **modular architecture**. Each feature lives in its own file inside the `modules/` directory. Modules can register slash commands, run background listeners (via `init(client)`), or both.

Modules can be:
- Enabled / disabled at runtime using `/modules`
- Reloaded without restarting the bot
- Protected behind admin checks

**Before writing or editing a module's reply/button/select-menu/modal logic,
read [`INTERACTIONS.md`](INTERACTIONS.md).** It defines the standard every
module follows: one edited message per result (never a stream of new
messages for one action), the shared `lib/interactions.js` helpers, the
`modname:action:payload` customId convention, and when to reach for buttons,
select menus, or modals. New modules and edits to existing ones should
conform to it.

---

## Module Categories

### Admin & Management
- `help` — Dynamic help system
- `info` — Rich user and server information
- `modules` (module-manager) — Runtime module management
- `presence` (rich_presence) — Control the bot's Discord activity/presence
- `reload` — Reload all slash commands
- `settings` — View and modify bot configuration live
- `shell` — Execute shell commands (whitelisted for normal users, full access for admins)
- `webhooks` — Create, manage, and view webhooks

### Moderation & Utilities
- `dm` — Send direct messages as the bot
- `file_upload` — Upload local files from the host to Discord
- `rm` (shredder) — Advanced message cleanup with time windows and backup
- `role_manager` — Add, remove, and list roles on users

### Media & Downloads
- `music` — Voice music player (YouTube support, queue, controls)
- `yt` — YouTube search + direct mp3/mp4 downloads via yt-dlp
- `audio` — Legacy redirect (points to `/music` and `/yt`)

### Fun & Entertainment
- `image` — Random memes (`losowe`) and NSFW images (`cycki`)
- `joke` — Random jokes from public APIs
- `quote` — Random quotes (Boner, Bomba, jokes, text emojis)
- `rng` — Random generators (coinflip, dice, number, random string)
- `tictactoe` — Play Tic Tac Toe with buttons

### Passive / Background Features
- `anon` — Send anonymous messages to configured channels
- `dms` — Log direct messages received by the bot
- `reaction` — Reaction role system (configurable via JSON)
- `responses` — Keyword-based auto responder (uses `misc/responses.txt`)
- `ollama` — Local AI agent via Ollama (mention / reply-to-bot triggers)

### Other / Niche
- `crypto` — Cryptocurrency prices (CoinGecko)
- `ping` — Simple latency check
- `reload` — Command reload utility

---

## Detailed Module Documentation

### `/help`
**File:** `help.js`

Dynamic help command that reads live from registered slash commands.

**Usage:**
- `/help` — Shows all available commands grouped by category, with a select menu to jump to any command's details in the same message (⬅ button to go back)
- `/help <command>` — Shows detailed information about a specific command (including subcommands and options)

Automatically stays up to date when modules are enabled/disabled.

---

### `/info`
**File:** `info.js`

Rich information lookup for users and servers.

**Subcommands:**
- `/info user [target]` — Detailed user information (account age, join date, roles, badges, permissions, etc.)
- `/info server` — Comprehensive server statistics (members, boosts, channels, features, verification level, etc.)

Both commands are sent ephemerally by default.

---

### `/modules`
**File:** `module-manager.js`

Runtime management of bot modules.

**Subcommands:**
- `/modules list` — Show all modules and their current status (enabled/disabled), with a select menu to toggle a module directly in the same message
- `/modules enable <name>`
- `/modules disable <name>`
- `/modules reload` — Fully reload all modules and slash commands

Critical admin modules (`module-manager`, `settings`, `reload` — by file name) cannot be disabled for safety.

---

### `/presence`
**File:** `rich_presence.js` (command name: `presence`)

Control the bot's visible activity/status.

**Subcommands:**
- `/presence set <type> <text> [url]`
- `/presence clear`
- `/presence status`

Supported types: Playing, Listening, Watching, Competing, Streaming, Custom.

The last set presence is saved and restored automatically on bot restart.

---

### `/settings`
**File:** `settings.js`

Live configuration management.

**Subcommands:**
- `/settings list` — Show current configuration, with an "Edytuj (modal)" button for a quick key/value edit without re-running the command
- `/settings get <key>` — Get a specific value (supports dot notation)
- `/settings set <key> <value>` — Change a value (supports JSON for complex objects)
- `/settings reload` — Reload `config.json` from disk

Changes are persisted immediately.

---

### `/shell`
**File:** `shell.js`

Execute commands on the host machine.

**Usage:**
- `/shell <command>`
- `/shell` (no argument) — admins get a modal to type the full command; everyone else gets a select menu scoped to the safe whitelist, with a follow-up modal for commands that take text input

**Behavior:**
- Normal users: Limited to a safe whitelist (`figlet`, `toilet`, `cowsay`, `fortune`, `uptime`), always run via `execFile` (never a shell) so no argument — typed or via modal — can inject shell syntax
- Admins: Full unrestricted shell access

Includes execution timeouts and output length protection.

---

### `/webhooks`
**File:** `webhooks.js`

Full webhook management system.

**Subcommands:**
- `/webhooks list` — select menu → detail view (edit via modal / delete with confirm / back), all in the same message
- `/webhooks create <name> <channel> [avatar]`
- `/webhooks edit <webhook> [name] [avatar] [channel]`
- `/webhooks delete <webhook>`
- `/webhooks info <webhook>` — Shows the full webhook URL (ephemeral)

Features autocomplete when selecting existing webhooks. After creation, the secret URL is shown only to the creator.

---

### `/rm` (Shredder)
**File:** `shredder.js`

Advanced message cleanup tool.

**Subcommands:**
- `/rm channel <time> [backup]`
- `/rm global <time> [backup]`
- `/rm user <user> <time> [backup]`

Supports time formats like `30s`, `15m`, `2h`, `1d`. Optional backup creates text logs + downloads attachments before deletion.

Requires `ManageMessages` permission (and bot admin). Destructive and irreversible, so the command always shows a confirm/cancel button pair first — nothing is deleted until you click **Usuń**; progress and the final summary reuse that same message.

---

### `/music`
**File:** `music.js`

Full-featured voice music player.

**Subcommands:**
- `join`, `leave`
- `play <query or URL>`
- `pause`, `resume`, `stop`, `skip`
- `queue`

Supports YouTube search and direct URLs. Uses yt-dlp for audio extraction. Per-guild queues.

Playback shows one persistent "now playing" control panel per guild (⏸️ Pauza / ▶️ Wznów / ⏭️ Pomiń / ⏹️ Stop / 📜 Kolejka buttons) that gets edited in place for every track change — the panel outlives the slash command's 15-minute interaction window since a queue can run for hours.

---

### `/yt`
**File:** `yt.js`

YouTube tools.

**Subcommands:**
- `/yt search <query> [max]` — results come with a select menu; picking one reveals MP3/MP4 buttons that download directly from the search, no need to copy/paste a URL into `/yt mp3`
- `/yt mp3 <url>` (Admin)
- `/yt mp4 <url>` (Admin)

Uses yt-dlp under the hood. Downloads are restricted to admins. The downloaded file is attached to the same message the command replied with (progress → file), never a separate upload message.

**Cookies:** defaults to `yt-dlp --cookies-from-browser firefox`, falling through `chrome`, `chromium`, `brave`, `edge`, `vivaldi`, `opera` (first one with a detected profile directory on the host wins), then a `cookies.txt` file at the repo root if present, then no cookies at all. No configuration needed — just have one of those browsers' profile present on the host (or drop a `cookies.txt`) if age-restricted/region-locked videos need to work.

---

### `/responses`
**File:** `responses.js`

Passive keyword responder.

- Loads triggers from `misc/responses.txt`
- Responds with a configurable probability
- Can be toggled live with `/modules`
- Includes management commands (`/responses reload`, `/responses chance`, `/responses list`)

---

### `/ollama`
**File:** `ollama.js`  
**Config:** `config/ollama.json`

Local AI agent backed by an [Ollama](https://ollama.com) server. When triggered, the message text is sent to the LLM; the model reply is posted as a Discord reply in the same channel (split across multiple messages if needed; Discord hard-caps content at **2000** characters per message).

**Triggers (passive `messageCreate` listener):**
- **Bot mention** — e.g. `@Bot what is the weather metaphor for?`
- **Reply to the bot** — replying to any of the bot’s messages continues the conversation

Mention tokens are stripped before the text is used as the user prompt. Empty prompts get a short help line from config.

**Slash commands:**
- `/ollama status` — Module state, model, server URL, connectivity (`/api/tags`), history/inference summary
- `/ollama ask [prompt] [private]` — One-shot question (optional ephemeral reply); leave `prompt` empty to compose it in a modal. Every answer gets 🔄 Regeneruj and 🗑️ Wyczyść historię buttons, both editing the same message.
- `/ollama reload` — Reload `config/ollama.json` from disk (admin)
- `/ollama clear-history [scope]` — Clear channel or all in-memory history (admin)
- `/ollama model [name]` — Get/set model name and persist to config (admin)
- `/ollama config` — Summary of active config (admin)

**Rich config (`config/ollama.json`) highlights:**

| Section | Purpose |
|---------|---------|
| `server.baseUrl` | Client URL (default `http://127.0.0.1:11434`; server binds per `ollama-env.sh` `OLLAMA_HOST`) |
| `server.timeoutMs` | Client abort timeout; `0` = none (aligned with `OLLAMA_LOAD_TIMEOUT=-1`) |
| `server.keepAlive` | Passed as `keep_alive` on each request (default `2m`) |
| `server.think` | **`false` by default.** Thinking models (Qwen3.5) otherwise put the whole generation in `message.thinking` and leave `message.content` empty, which made the bot post `errorMessage` on HTTP 200 |
| `server.env` | Mirror of `config/ollama-env.sh` for reference (server-side knobs) |
| `server.api` | `"chat"` (`/api/chat`) or `"generate"` (`/api/generate`) |
| `model` | Model tag (e.g. `llama3.2`, `mistral`, `qwen2.5`) |
| `systemPrompt` | System instructions for the agent |
| `triggers.*` | Mention/reply toggles, channel/guild/user allow & block lists |
| `history.*` | In-memory multi-turn context (`scope`: `channel`, `user`, `channel-user`, `guild-user`), `maxMessages`, TTL |
| `inference.*` | Ollama options; `num_ctx` defaults to **8192** (`OLLAMA_CONTEXT_LENGTH`) |
| `response.*` | Short-reply bias, split strategy, typing, max chars; **`stripThinking`** drops CoT/`<think>` so only the final reply is posted |
| `rateLimit.*` | Per-user cooldown and busy handling |

Server process env lives in **`config/ollama-env.sh`** (`OLLAMA_CONTEXT_LENGTH`, `OLLAMA_KEEP_ALIVE`, flash attention, KV cache, etc.). The Discord module does not start Ollama; it only talks to the API with matching client settings.

After editing the JSON file, run `/ollama reload` (or restart the bot). Toggle the whole module with `/modules disable ollama` / `enable`.

**Requirements:**
- A running Ollama instance reachable from the bot host
- The chosen model pulled (`ollama pull <model>`)
- Discord intents already used by the bot: `Guilds`, `GuildMessages`, `MessageContent` (mentions + content)

**Docker note:** If the bot runs in Docker and Ollama on the host, set `server.baseUrl` to something like `http://host.docker.internal:11434` (or the host LAN IP), not `127.0.0.1`.

---

### Other Notable Modules

- **`/image`** — `/image losowe` (memes with multiple fallbacks) and `/image cycki` (NSFW) — both have a 🔄 "Losuj ponownie" button
- **`/quote`** — Random Boner, Bomba, jokes, and text emojis — 🔄 reroll button
- **`/joke`** — Clean public joke APIs — 🔄 reroll button
- **`/rng`** — Coin, dice, random numbers/strings — 🔄 reroll button (keeps the same max/sides)
- **`/role`** — Role management (add/remove/list)
- **`/dm`** — Send DMs as the bot (admin) — leave `message` empty to compose it in a modal instead
- **`/crypto`** — Live cryptocurrency prices — 🔄 refresh button
- **`/tictactoe`** — Button-based multiplayer game, 10-minute idle timeout, 🔁 rematch button on game end
- **`/anon`** — Anonymous messaging to pre-configured channels — leave `message` empty (and no file) to compose it in a modal instead
- **`/reaction`** — Reaction roles (configured via `config/reaction-roles.json`)
- **`/dms`** — Passive DM logging to `dm-logs/`

---

## Passive Modules

Some modules do not primarily register slash commands. Instead, they use the `init(client)` hook to attach listeners:

- `responses` (messageCreate)
- `reaction` (messageReactionAdd/Remove)
- `dms` (messageCreate for DMs)
- `ollama` (messageCreate — mention / reply-to-bot AI agent)
- `anon` (uses slash but has special behavior)

These can still be enabled/disabled at runtime.

---

## Requirements & External Tools

Several modules depend on external tools being installed on the host:

| Module     | Requirement          | Notes                              |
|------------|----------------------|------------------------------------|
| `shell`    | —                    | Runs on the host machine           |
| `yt`       | `yt-dlp`             | Required for search + downloads    |
| `music`    | `yt-dlp` + FFmpeg    | Voice playback                     |
| `shredder` | —                    | Needs `ManageMessages` permission  |
| `webhooks` | `ManageWebhooks`     | Discord permission                 |
| `ollama`   | Ollama server        | Local LLM API (`/api/chat`)        |

---

## Development Notes

- All modules are hot-reloadable via `/modules reload`
- New modules are automatically discovered (no registration needed)
- Admin-only commands generally use `interaction.client.isAdmin()`
- Passive features should check `client.isModuleEnabled("modulename")` on every event

---

*This document is the authoritative reference for module capabilities. Keep it updated when adding or significantly changing modules.*