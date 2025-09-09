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

Update `config.json` with the mapping key from `.discordrc` and run:

```bash
# Interactive menu
node main.js

# Start directly
node main.js --bot "bot 1"
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
