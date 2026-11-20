# Universal Discord Bot (Node.js)

A powerful, modular Discord bot written in Node.js with modern slash commands, dynamic module loading, and extensive management tools.

## Features

- 📦 **Fully modular** — Every feature is a standalone `.js` file in `modules/`
- 🧩 **Dynamic slash commands** with autocomplete support
- 🔄 **Runtime module management** — enable/disable/reload modules without restarting
- 🛠️ **Rich admin tools** — settings, webhooks, presence, shell access, message cleanup, etc.
- 📜 **Comprehensive documentation** — see `MODULES.md` for full details on every module
- 🐳 **Full Docker support** — `docker.sh` (interactive), node:22-alpine, proper volume layout, no .env mount leaks

## Project Structure

```
Universal-Discord-Bot/
├── modules/                # All bot features (26+ modules)
├── config.json             # Bot configuration + per-bot settings
├── .env                    # Bot tokens (JSON format, gitignored)
├── docker.sh               # Interactive Docker manager (recommended)
├── docker-compose.yml      # Compose file (auto-updated by docker.sh for chosen bot)
├── Dockerfile
├── docker-entrypoint.sh    # Volume permission fix + drops privileges to node user
├── .dockerignore           # Keeps secrets and junk out of the image
├── setup.sh                # Interactive first-run (Node path)
├── main.js
├── README.md
├── MODULES.md
├── TODO.md
└── ...
```

## Quick Start (Recommended)

The easiest way to get started is using the setup script:

```bash
chmod +x setup.sh
./setup.sh
```

The script will:

1. Check for Node.js and install dependencies (`npm install`)
2. Create `.env` (if missing) with proper JSON format
3. Prompt for **bot name** and **bot token**
4. Automatically add the bot to `config.json`
5. Offer to start the bot immediately

### Manual Setup

If you prefer manual setup:

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create `.env`** (JSON format):
   ```json
   {
     "MyBot": "YOUR_BOT_TOKEN_HERE"
   }
   ```

3. **Configure `config.json`** — Add your bot under the `bots` object:
   ```json
   "bots": {
     "MyBot": {
       "modules_folder": "modules",
       "enabled_modules": [],
       "disabled_modules": []
     }
   }
   ```

4. **Run the bot**
   ```bash
   # Interactive menu
   node main.js

   # Direct start
   node main.js --bot MyBot

   # With debug logging
   node main.js --bot MyBot --debug
   ```

## Documentation

- **[MODULES.md](MODULES.md)** — Complete documentation for all 26+ modules (highly recommended)
- **[INTERACTIONS.md](INTERACTIONS.md)** — The interaction standard every module follows (single edited message per result, buttons/select menus/modals, `lib/interactions.js`) — read before writing or editing a module's reply logic
- **[TODO.md](TODO.md)** — Planned features and development roadmap

## Running Multiple Bots

The bot supports running multiple instances from a single installation:

```json
// .env
{
  "SkyNET": "token1...",
  "HelperBot": "token2..."
}
```

Then start with:
```bash
node main.js --bot SkyNET
```

## Module Management

Once the bot is running, use these powerful slash commands:

- `/modules list` — See all modules and their status
- `/modules enable <name>`
- `/modules disable <name>`
- `/modules reload` — Hot-reload all commands

See `MODULES.md` for the full list of available modules (including powerful ones like `/rm`, `/webhooks`, `/music`, `/shell`, `/info`, etc.).

## Requirements

- **Node.js** >=22.12 (required by @discordjs/voice)
- **yt-dlp** (for `/yt` and `/music` modules)
- **FFmpeg** (for voice features in `/music`)
- Appropriate Discord bot permissions (Manage Messages, Manage Webhooks, etc.)

## Docker Support

Production-ready Docker support is included.

**Recommended:** Use the interactive manager:

```bash
chmod +x docker.sh
./docker.sh
```

It handles:
- Choosing which bot from your JSON `.env`
- Building with the correct Node 22 + yt-dlp + ffmpeg image
- Creating the clean `./docker/` volume layout
- Permanently setting `container_name` + `--bot` argument (no reverting)
- Injecting the JSON `.env` safely via `docker cp` after start (never as a volume)

**Key design guarantees:**
- `.env` (JSON tokens) is **never** a bind mount or volume.
- Docker Compose is explicitly told to ignore the local `.env` (`--env-file /dev/null`).
- All persistent data lives only under `./docker/{logs,downloads,backups,dm-logs,config}`.
- Runs as non-root `node` user after volume permissions are fixed at startup.
- Uses `node:22-alpine` (satisfies `@discordjs/voice` requirement).

### Quick Start

```bash
./docker.sh
# Then choose option 1 (Up)
```

See the full "Docker Support" section inside the interactive `docker.sh` help or the comments in `Dockerfile` / `docker-compose.yml` for advanced usage.

### Why this approach?

Earlier attempts that mounted `.env` or temporarily renamed it to `.env.bak` caused `EISDIR` crashes (`main.js` saw a directory instead of the JSON file). The current design (copy after start + `--env-file /dev/null`) completely eliminates that class of problem.

## Contributing

- New modules go into `modules/`
- Follow the existing pattern (export `{ data, execute }`, and optionally `handleComponent`/`handleModal` — see below)
- Use `client.isAdmin()` for privileged actions
- Document new modules in `MODULES.md`
- Follow the reply/component/modal standard in **[INTERACTIONS.md](INTERACTIONS.md)** — one edited message per result, via the shared helpers in `lib/interactions.js`

## Status

This is a complete, modern rewrite of the original Python bot in Node.js (discord.js v14, slash commands only). All major modules have been ported and improved, with rich admin tooling and first-class Docker support.

For the exhaustive per-module reference, see **[MODULES.md](MODULES.md)**.

---

"Not as good as other bots, but good enough!"
