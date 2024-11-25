import discord
from discord.ext import commands
import random

class KeywordResponder(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.responses = self.load_responses_from_file("responses.txt")

    def load_responses_from_file(self, filepath):
        responses = {}
        with open(filepath, 'r', encoding='utf-8') as file:
            for line in file:
                # Split each line by the first colon found
                keyword, response_str = line.strip().split(':', 1)
                # Split the responses by commas and strip whitespace
                responses[keyword] = [resp.strip() for resp in response_str.split(',')]
        return responses

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author == self.bot.user:
            return

        if random.random() < 0.35:  # 55% chance to trigger a response
            for keyword in self.responses:
                if keyword in message.content.lower():
                    response = random.choice(self.responses[keyword])
                    await message.channel.send(response)
                    break

async def setup(bot):
    await bot.add_cog(KeywordResponder(bot))
