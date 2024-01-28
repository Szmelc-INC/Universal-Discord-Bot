import discord
from discord.ext import commands
import random

class KeywordResponder(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.responses = {
            "ruchanie": ["https://i.imgur.com/98muP8N.jpg", "https://i.imgur.com/PvJapA5.png", "RUCHANIE", "Ru cha nie", "https://www.youtube.com/watch?v=mEFPTn8tcnc", "( ͡° ͜ʖ ͡°)"],
            "keyword2": ["Response 3", "Response 4"],
            "WY": ["PIER"],
            "DA": ["LAJ"],
            # Add more keywords and responses as needed
        }

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author == self.bot.user:
            return
        for keyword in self.responses:
            if keyword in message.content.lower():
                response = random.choice(self.responses[keyword])
                await message.channel.send(response)
                break

async def setup(bot):
    await bot.add_cog(KeywordResponder(bot))
