import discord
from discord.ext import commands
import random
import string

class FunGamesCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name='coinflip')
    async def coin_flip(self, ctx):
        result = random.choices(['Heads', 'Tails', 'Edge'], weights=[49.5, 49.5, 1], k=1)[0]
        await ctx.send(f"The coin landed on: {result}")

    @commands.command(name='diceroll')
    async def dice_roll(self, ctx, sides: int):
        if sides not in [6, 20]:
            await ctx.send("Please choose a 6-sided or 20-sided dice.")
            return
        result = random.randint(1, sides)
        await ctx.send(f"You rolled a {sides}-sided dice and got: {result}")

    @commands.command(name='randomstring')
    async def random_string(self, ctx, length: int):
        if length <= 0 or length > 100:
            await ctx.send("Please specify a length between 1 and 100.")
            return
        result = ''.join(random.choices(string.ascii_letters + string.digits, k=length))
        await ctx.send(f"Your random string: {result}")

async def setup(bot):
    await bot.add_cog(FunGamesCog(bot))
