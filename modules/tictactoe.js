const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

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
    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button });

    collector.on('collect', async i => {
      const idx = parseInt(i.customId.split('_')[1], 10);
      if (game.board[idx] || (i.user.id !== game.current.id)) {
        return i.reply({ content: "Not your turn!", ephemeral: true });
      }
      const symbol = game.current.id === p1.id ? '❌' : '🔵';
      game.mark(idx, symbol);
      const won = game.check(symbol);
      game.current = game.current.id === p1.id ? p2 : p1;
      if (won) {
        collector.stop('win');
        return i.update({ content: `${i.user} wins!`, components: game.buttons });
      }
      await i.update({ components: game.buttons });
    });

    collector.on('end', (_collected, reason) => {
      if (reason !== 'win') {
        interaction.followUp('Game ended.');
      }
    });
  }
};
