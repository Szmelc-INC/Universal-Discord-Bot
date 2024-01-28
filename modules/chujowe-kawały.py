import discord
from discord.ext import commands
import requests
from bs4 import BeautifulSoup
import random

class JokeCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command()
    async def joke(self, ctx):
        page_number = random.randint(2, 337)
        try:
            response = requests.get(f"https://perelki.net/?ps={page_number}")
            if response.status_code != 200:
                await ctx.send("Couldn't fetch a joke at the moment.")
                return

            soup = BeautifulSoup(response.content, 'html.parser')
            jokes = soup.find_all("div", class_="container joke-here")
            
            if jokes:
                random_joke = random.choice(jokes)
                joke_text = ' '.join(random_joke.stripped_strings)
                await ctx.send(joke_text)
            else:
                await ctx.send("No jokes found on the page.")
        
        except Exception as e:
            await ctx.send(f"An error occurred: {e}")

async def setup(bot):
    await bot.add_cog(JokeCog(bot))
