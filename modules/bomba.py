import discord
from discord.ext import commands
import requests
from bs4 import BeautifulSoup
import random

class KapitanBombaCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.url = "https://nonsa.pl/wiki/Cytaty:Kapitan_Bomba"

    def get_random_quote(self):
        try:
            response = requests.get(self.url)
            soup = BeautifulSoup(response.content, 'html.parser')
            quotes = []

            # Find all <ul><li><i> tags for quotes
            list_items = soup.find_all('li')
            for li in list_items:
                italics = li.find('i')
                if italics:
                    quotes.append('\n'.join(italics.stripped_strings))

            return random.choice(quotes) if quotes else "No quotes found."
        except Exception as e:
            return f"Error fetching quote: {e}"

    @commands.command()
    async def bomba(self, ctx):
        quote = self.get_random_quote()
        await ctx.send(quote)

async def setup(bot):
    await bot.add_cog(KapitanBombaCog(bot))
