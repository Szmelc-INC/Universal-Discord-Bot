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
- `export` — Scrape & export messages to a zip, delivered by DM (attached, or via bashupload when large)
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

**Behavior:**
- Normal users: Limited to a safe whitelist (`figlet`, `toilet`, `cowsay`, `fortune`, `uptime`)
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

### `/export`
**File:** `export.js`
**Working directory:** `exports/` (git-ignored, created on demand, emptied on success)

Configurable message scraper. Collects messages into a local working folder, archives it, delivers
the archive to whoever ran the command by DM, and only then deletes the local copy. **Admin only**
(`client.isAdmin`), guild-only.

**Delivery depends on size.** Archives of **10 MiB or less are attached to the DM directly** — no
third-party host, no expiring link. Anything larger is uploaded to
[bashupload.app](https://bashupload.app) and the DM carries the service's **raw response verbatim
in a code block**, single-use download link included. The response is never reformatted or
rewritten, so what the DM shows is exactly what the host returned. If Discord refuses the direct
attachment (per-server size tiers vary), the module falls back to the upload path automatically.

**Subcommands:**
- `/export run [options]` — run an export
- `/export status` — progress of the export running in this server
- `/export cancel` — stop it; partial files are removed and nothing is uploaded

**`/export run` options** (every one is optional — the defaults export the current channel, all
users, no media, since the beginning of history):

| Option | Values | Default |
|--------|--------|---------|
| `scope` | `channel`, `global` (every readable channel in the server) | `channel` |
| `channel` | any text channel (`scope=channel` only) | the current channel |
| `user` | a user to filter on | all users |
| `media` | `true` / `false` — download attachments into the archive | `false` |
| `since` | `24h`, `7d`, `30m`, an ISO date, or `beginning` | `beginning` |
| `from` | window start — ISO date or relative (`7d`); overrides `since` | — |
| `to` | window end — ISO date, relative (`2h`), or `now` | `now` |
| `format` | `both`, `json`, `txt` | `both` |
| `threads` | `true` / `false` — also scrape **active** threads and forum posts | `false` |
| `limit` | safety cap on total messages (1–500000) | `50000` |

**Archive layout:**

```
export-<date>.zip
├── manifest.json                  # configuration, totals, per-channel counts, errors
├── summary.txt                    # human-readable report
├── channels/<name>-<id>.json      # full message records
├── channels/<name>-<id>.txt       # flat transcript
└── media/<name>-<id>/...          # attachments (only with media:true)
```

**Behaviour worth knowing:**
- **Progress updates live.** The ephemeral reply is rewritten as the job runs — stage, elapsed
  time, a channel progress bar, messages collected vs scanned, media counters and a packing bar
  during archiving. Updates are emitted per history page and per downloaded attachment, throttled
  to one edit every `progressIntervalMs` (5 s) to stay inside Discord's rate limits.
- **Deletion is conditional.** Local files are removed only after the DM is delivered. If the DM
  fails (closed DMs, error 50007), the archive is **kept** on the host and the upload response is
  written to the console and to the ephemeral reply — nothing is lost.
- **Long exports outlive the interaction.** Discord invalidates an interaction token after 15
  minutes, so all progress edits are best-effort and the DM is the real delivery channel. A
  multi-hour global export still delivers.
- **Timeframes use snowflake cursors,** so `since: 2h` fetches only that slice instead of walking
  the whole channel history.
- **Permissions:** a channel is included when the bot has `View Channel` + `Read Message History`
  (deliberately *not* `Manage Messages` — exporting only reads). The command's
  `setDefaultMemberPermissions` is only a visibility hint set to `Manage Server`; real
  authorization is `client.isAdmin`, so `config.adminRoles` members are not locked out by Discord
  before the check runs.
- Threads and forum posts are excluded unless `threads: true`. Only *active* threads are covered —
  archived threads are never scraped. The manifest records which of the two applied. Selecting a
  forum channel directly requires `threads: true`, since a forum holds no messages of its own.
- One export at a time per server.

**No external binaries required.** The archive is written by a built-in ZIP writer and the upload
falls back to a native HTTPS `PUT` when `curl` is missing — the `node:22-alpine` image ships
neither `zip` nor `curl`.

**Optional tuning** via a `export` block in `config.json`:

| Key | Meaning | Default |
|-----|---------|---------|
| `directAttachmentMaxBytes` | archives up to this size are DM'd directly instead of uploaded | `10485760` (10 MiB) |
| `maxMessages` | default message cap | `50000` |
| `maxAttachmentBytes` | per-attachment size limit | `26214400` (25 MB) |
| `maxMediaTotalBytes` | total media budget per export | `536870912` (512 MB) |
| `fetchDelayMs` | pause between history pages | `250` |
| `progressIntervalMs` | progress-edit throttle | `5000` |
| `uploadTimeoutMs` | upload timeout | `1800000` (30 min) |

> When bashupload is used, the download link is **single use** — the file is deleted after the
> first download. Archives that fit in a DM avoid this entirely.

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
- `/ollama ask <prompt> [private]` — One-shot question (optional ephemeral reply)
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
| `export`   | — (`curl` optional)  | Built-in zip + native HTTPS upload |
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