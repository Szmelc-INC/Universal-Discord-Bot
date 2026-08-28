const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');

class TicTacToeGame {
  constructor(player1, player2) {
    this.player1 = player1;
    this.player2 = player2;
    this.current = player1;
    this.board = Array(9).fill(null);
    this.buttons = this.createButtons();
  }

  createButtons() {
    const rows = [];
    for (let i = 0; i < 3; i++) {
      const row = new ActionRowBuilder();
      for (let j = 0; j < 3; j++) {
        const idx = i * 3 + j;
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`ttt_${idx}`)
            .setLabel('⬜')
            .setStyle(ButtonStyle.Secondary)
        );
      }
      rows.push(row);
    }
    return rows;
  }

  mark(idx, symbol) {
    this.board[idx] = symbol;
    const row = Math.floor(idx / 3);
    const col = idx % 3;
    this.buttons[row].components[col].setLabel(symbol);
  }

  check(symbol) {
    const b = this.board;
    const wins = [
      [0,1,2],[3,4,5],[6,7,8],
      [0,3,6],[1,4,7],[2,5,8],
      [0,4,8],[2,4,6]
    ];
    return wins.some(line => line.every(i => b[i] === symbol));
  }

  isFull() {
    return this.board.every(c => c !== null);
  }
}

const IDLE_TIMEOUT = 10 * 60_000; // abandon the game if nobody moves for 10 min

function rematchRow() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ttt_rematch').setLabel('🔁 Rewanż').setStyle(ButtonStyle.Primary)
  )];
}

// Runs one game to completion on `message` (created by /game, or by a previous
// rematch), then offers a rematch button on the SAME message rather than
// spawning a new one. Recurses on rematch instead of starting a fresh message.
function startGame(message, p1, p2) {
  const game = new TicTacToeGame(p1, p2);
  // Set synchronously in the same tick as collector.stop(), so 'end' below
  // never has to guess the outcome from message.content — reading that back
  // races the in-flight i.update() that's setting it (content wasn't touched
  // by i.update() yet from 'end's point of view, since Message#edit() only
  // reflects a completed API round trip, not the update the client just sent).
  let finalContent = null;
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, idle: IDLE_TIMEOUT });

  collector.on('collect', async i => {
    if (i.customId === 'ttt_rematch') return; // handled by the separate rematch collector below
    const idx = parseInt(i.customId.split('_')[1], 10);
    if (game.board[idx] || (i.user.id !== game.current.id)) {
      return i.reply({ content: "Not your turn!", flags: MessageFlags.Ephemeral });
    }
    const symbol = game.current.id === p1.id ? '❌' : '🔵';
    game.mark(idx, symbol);
    const won = game.check(symbol);
    const full = !won && game.isFull();
    game.current = game.current.id === p1.id ? p2 : p1;

    if (won) {
      finalContent = `${i.user} wins!`;
      collector.stop('win');
      return i.update({ content: finalContent, components: game.buttons });
    }
    if (full) {
      finalContent = "It's a draw!";
      collector.stop('draw');
      return i.update({ content: finalContent, components: game.buttons });
    }
    await i.update({ components: game.buttons });
  });

  collector.on('end', async (_collected, reason) => {
    // Interaction tokens (and therefore followUp/editReply) expire after 15
    // minutes — this game can run far longer than that, so the end-of-game
    // update goes through Message#edit, not the original interaction.
    const base = finalContent ?? (message.content || 'Tic Tac Toe');
    const suffix = reason === 'idle' ? '\n⌛ Game abandoned (no moves for 10 min).' : '';
    try {
      await message.edit({
        content: base + suffix,
        components: [...game.buttons, ...rematchRow()]
      });
    } catch { /* message may have been deleted */ }

    const rematchCollector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: i => i.customId === 'ttt_rematch',
      time: 5 * 60_000,
      max: 1
    });
    rematchCollector.on('collect', async i => {
      if (i.user.id !== p1.id && i.user.id !== p2.id) {
        return i.reply({ content: 'Only the two players can start a rematch.', flags: MessageFlags.Ephemeral });
      }
      const fresh = new TicTacToeGame(p1, p2);
      await i.update({ content: `Tic Tac Toe: ${p1} (❌) vs ${p2} (🔵)`, components: fresh.buttons });
      startGame(message, p1, p2);
    });
    rematchCollector.on('end', collected => {
      if (!collected.size) message.edit({ components: [...game.buttons] }).catch(() => {});
    });
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('game')
    .setDescription('Start a TicTacToe game between two users')
    .addUserOption(opt => opt.setName('player1').setDescription('First player').setRequired(true))
    .addUserOption(opt => opt.setName('player2').setDescription('Second player').setRequired(true)),
  async execute(interaction) {
    const p1 = interaction.options.getUser('player1');
    const p2 = interaction.options.getUser('player2');
    if (p1.id === p2.id) {
      return interaction.reply('Players must be different.');
    }
    const game = new TicTacToeGame(p1, p2);
    const message = await interaction.reply({ content: `Tic Tac Toe: ${p1} (❌) vs ${p2} (🔵)`, components: game.buttons, fetchReply: true });
    startGame(message, p1, p2);
  }
};
