import discord
from discord.ext import commands
from discord.ui import Button, View

class TicTacToeView(View):
    def __init__(self, player1: discord.Member, player2: discord.Member):
        super().__init__(timeout=None)
        self.player1 = player1
        self.player2 = player2
        self.current_player = player1
        self.board = ["⬜"] * 9
        self.game_over = False
        self.create_buttons()

    def create_buttons(self):
        for i in range(9):
            button = Button(label="⬜", style=discord.ButtonStyle.secondary, row=i // 3)
            button.callback = self.button_callback(i)
            self.add_item(button)

    def button_callback(self, pos):
        async def callback(interaction: discord.Interaction):
            if self.game_over or self.children[pos].label != "⬜":
                return

            # Check if the correct player is making the move
            if interaction.user != self.current_player:
                await interaction.response.send_message(f"It's not your turn!", ephemeral=True)
                return

            symbol = "❌" if self.current_player == self.player1 else "🔵"
            self.children[pos].label = symbol
            self.board[pos] = symbol

            if self.check_winner(self.board, symbol):
                self.game_over = True
                await interaction.response.edit_message(content=f"{self.current_player.mention} wins!", view=self)
                return
            else:
                self.current_player = self.player1 if self.current_player == self.player2 else self.player2
                await interaction.response.edit_message(view=self)

        return callback

    def check_winner(self, board, symbol):
        win_conditions = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ]
        return any(all(board[i] == symbol for i in condition) for condition in win_conditions)


class TicTacToe(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command()
    async def game(self, ctx, player1: discord.Member, player2: discord.Member):
        if player1 == player2:
            await ctx.send("A player cannot play against themselves.")
            return

        view = TicTacToeView(player1, player2)
        await ctx.send(f"Tic Tac Toe: {player1.mention} (❌) vs {player2.mention} (🔵)", view=view)

async def setup(bot):
    await bot.add_cog(TicTacToe(bot))
