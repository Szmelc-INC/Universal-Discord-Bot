# Universal Discord Bot — Modules Documentation

This document provides a complete overview and usage guide for all modules available in the **Universal Discord Bot**.

## Overview

The bot is designed around a **modular architecture**. Each feature lives in its own file inside the `modules/` directory. Modules can register slash commands, run background listeners (via `init(client)`), or both.

Modules can be:
- Enabled / disabled at runtime using `/modules`
- Reloaded without restarting the bot
- Protected behind admin checks

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
- `/help` — Shows all available commands grouped by category
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
- `/modules list` — Show all modules and their current status (enabled/disabled)
- `/modules enable <name>`
- `/modules disable <name>`
- `/modules reload` — Fully reload all modules and slash commands

Critical admin modules (like `modules`, `settings`, `reload`) cannot be disabled for safety.

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
- `/settings list` — Show current configuration
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
- `/webhooks list`
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

Requires `ManageMessages` permission (and bot admin).

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

---

### `/yt`
**File:** `yt.js`

YouTube tools.

**Subcommands:**
- `/yt search <query> [max]`
- `/yt mp3 <url>` (Admin)
- `/yt mp4 <url>` (Admin)

Uses yt-dlp under the hood. Downloads are restricted to admins.

---

### `/responses`
**File:** `responses.js`

Passive keyword responder.

- Loads triggers from `misc/responses.txt`
- Responds with a configurable probability
- Can be toggled live with `/modules`
- Includes management commands (`/responses reload`, `/responses chance`, `/responses list`)

---

### Other Notable Modules

- **`/image`** — `/image losowe` (memes with multiple fallbacks) and `/image cycki` (NSFW)
- **`/quote`** — Random Boner, Bomba, jokes, and text emojis
- **`/joke`** — Clean public joke APIs
- **`/rng`** — Coin, dice, random numbers/strings
- **`/role`** — Role management (add/remove/list)
- **`/dm`** — Send DMs as the bot (admin)
- **`/crypto`** — Live cryptocurrency prices
- **`/tictactoe`** — Button-based multiplayer game
- **`/anon`** — Anonymous messaging to pre-configured channels
- **`/reaction`** — Reaction roles (configured via `config/reaction-roles.json`)
- **`/dms`** — Passive DM logging to `dm-logs/`

---

## Passive Modules

Some modules do not primarily register slash commands. Instead, they use the `init(client)` hook to attach listeners:

- `responses` (messageCreate)
- `reaction` (messageReactionAdd/Remove)
- `dms` (messageCreate for DMs)
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

---

## Development Notes

- All modules are hot-reloadable via `/modules reload`
- New modules are automatically discovered (no registration needed)
- Admin-only commands generally use `interaction.client.isAdmin()`
- Passive features should check `client.isModuleEnabled("modulename")` on every event

---

*This document is the authoritative reference for module capabilities. Keep it updated when adding or significantly changing modules.*