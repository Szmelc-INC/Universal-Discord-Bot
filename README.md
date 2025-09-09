# Universal Discord Bot (Node.js)

A modular Discord bot rewritten in Node.js with modern slash commands and dynamic module loading.

## Features
- 📦 Each module is a standalone `.js` file located in `modules/`.
- 🧩 Automatic registration of slash commands with autocomplete support.
- 🏗️ CLI interface to start bots and manage modules.
- 🏷️ Runtime `--bot` flag to start a specific bot directly.
- 🔒 Bot tokens loaded from `.discordrc` (gitignored).

## Getting Started

```bash
npm install
```

Create a `.discordrc` file with your tokens:

```json
{
  "bot1": "YOUR_TOKEN"
}
```

> **Never commit this file.** The `.gitignore` already excludes it.

Configure your bots in `botconfig.json` (modules, admins, blacklist). The keys should match the names in `.discordrc`.

`botconfig.json` also provides response limits and how to handle content that exceeds them:

```json
"limits": {
  "maxMessageLength": 2000,
  "maxFileSize": 10485760,
  "maxFiles": 10,
  "strategy": "truncate" // or "split" / "file"
}
```

Use `split` to send long output in multiple messages or `file` to upload it as a text file.

Run the bot with:

```bash
# Interactive menu (lists bots from `.discordrc`)
node main.js

# Start directly by name
node main.js --bot bot1

# Save console output to a log file
node main.js --bot bot1 --log
```

## Creating Modules
A module exports a slash command definition and logic:

```js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Pong'),
  async execute(interaction) {
    await interaction.reply('Pong!');
  }
};
```

Place the file in the `modules/` directory and enable it through the CLI.

---

"Not as good as other bots, but good enough!"
