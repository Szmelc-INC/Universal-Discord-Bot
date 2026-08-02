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
- `democracy` — Direct-democracy voting engine (vote on almost anything: moderation, roles, channels, permissions, server settings, emoji/stickers)
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

### `/democracy`
**File:** `democracy.js`
**Config (rules):** `config/democracy.json`
**Runtime state:** `config/democracy-state.json` (auto-created, git-ignored — holds active votes, history and DM subscriptions; survives restarts and `/modules reload`)

Direct-democracy engine: anyone can start a vote about almost anything, everyone votes with buttons (secret ballot), and if it passes the bot executes the action automatically.

**Starting a vote — `/democracy start <category> …`:**
- `mod` — `op` (timeout / untimeout / kick / ban / unban), `user`, `punish_minutes` (timeout length, 1–40320), `vote_length`, `reason`, `ov_min_votes`
- `role` — `op` (create / delete / assign / unassign / permission / rename / recolor / hoist / mentionable), `role`, `user`, `name`, `permission` (autocomplete), `value`, …
- `channel` — `op` (create / delete / permission / rename / topic / nsfw / slowmode), `channel`, `type`, `target_role`/`target_user`, `permission` (autocomplete), `perm_state` (allow/deny/neutral → true/false/none), `value`, …
- `server` — `setting` (name / description), `value`
- `asset` — `type` (emoji / sticker), `op` (add / remove), `name`, `url`, `id`

Every start subcommand accepts `vote_length` (e.g. `30m`, `2h`, `1d`), an optional `reason` (**max 250 chars**, shown in the report/embed/event) and `ov_min_votes` (**admins only** — bypass the computed threshold).

**Management subcommands:**
- `/democracy list` — active votes on this server
- `/democracy info <vote_id>` — vote details; **admins also see who voted how**
- `/democracy history [limit]` — finished votes with results
- `/democracy stop <vote_id>` — **admin failsafe:** cancel & delete an ongoing vote
- `/democracy notify <on|off>` — toggle DM notifications for every new vote
- `/democracy config` — **admin:** show the active rules

**How it works:**
- Each vote posts a brief report in the vote channel, opens a **thread** with an embed "poll" (✅ ZA / ❌ PRZECIW / 🤝 WSTRZYMUJĘ SIĘ buttons) and creates a **guild scheduled event** (cosmetic, best-effort).
- **Secret ballot:** votes are tallied privately; the embed shows only aggregate counts. Identities are stored in state and revealed only to admins via `/democracy info`. *(Deliberate deviation: native Discord polls expose voters, which would break the secrecy requirement, so buttons + an aggregate embed are used instead of a native poll.)*
- **Outcome rule:** a vote **passes** when the quorum is met (total ballots ≥ `minVotes`) **and** the FOR share of decisive (FOR+AGAINST) ballots ≥ `passRatio` (default 50%) with FOR > AGAINST.
- **Thresholds** come from `config/democracy.json` per category and are scaled up by server size (`activeMemberRatio × guild.memberCount`, floored at the category minimum). Built-in floors match the spec: **ban 13 votes / 24h–7d**, **kick 7 / 1h–3d**, **timeout 3 / 5min–1h**, **role & channel delete 13 / 1h–14d**, **role & channel create 7**. *(min/max "time" = how long the vote runs; the timeout punishment length is the separate `punish_minutes` option.)*
- **Safety:** `Administrator` (and anything in `forbiddenPermissions`) can **never** be voted in; new roles are created with **no permissions** (each permission must be voted in/out one-by-one); the server owner, bot admins (`config.json` `admins`/`adminRoles`) and anyone in `protected` are **immune** to kick/ban/timeout/role changes. Immunity and bot hierarchy/permissions are re-checked **at execution time** — if the target left or the bot lost rights, the vote is archived with status `error` instead of crashing.
- **Admins bypass everything:** they can set any `vote_length` and override the threshold via `ov_min_votes` directly in the start command.
- Vote timers are persisted; on startup/reload active votes are rescheduled (and finalized immediately if their deadline already passed while the bot was offline).

**Requirements:** bot permissions matching the actions it must perform (`Ban Members`, `Kick Members`, `Moderate Members`, `Manage Roles`, `Manage Channels`, `Manage Guild`, `Manage Emojis and Stickers`, `Manage Events`, `Create Public Threads`), and a bot role higher than any role/member it acts on. Set `voteChannelId` in the config to pin where vote threads are opened (otherwise the command's channel is used).

---

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