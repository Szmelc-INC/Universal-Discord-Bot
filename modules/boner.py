import discord
from discord.ext import commands
import requests
from bs4 import BeautifulSoup
import random

class BogdanBonerCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.url = "https://egzorcysta.fandom.com/wiki/Bogdan_Boner"

    def get_random_quote(self):
        try:
            response = requests.get(self.url)
            if response.status_code != 200:
                return "Error: Unable to access the website."

            soup = BeautifulSoup(response.content, 'html.parser')
            quotes = soup.find_all('li')
            selected_quote = random.choice(quotes).get_text()

            # Remove citation links in parentheses if present
            return selected_quote.split('(')[0].strip()
        except Exception as e:
            return f"Error: {e}"

    @commands.command()
    async def boner(self, ctx):
        quote = self.get_random_quote()
        await ctx.send(quote)

async def setup(bot):
    await bot.add_cog(BogdanBonerCog(bot))
