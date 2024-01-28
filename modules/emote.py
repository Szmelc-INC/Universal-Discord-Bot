import discord
from discord.ext import commands
import requests
from bs4 import BeautifulSoup
import random

class TextEmojiCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command()
    async def textemoji(self, ctx):
        try:
            response = requests.get("https://www.piliapp.com/emoticon/")
            if response.status_code != 200:
                await ctx.send("Couldn't fetch an emoji at the moment.")
                return

            soup = BeautifulSoup(response.content, 'html.parser')
            emojis = [span['data-c'] for span in soup.find_all("span", class_="symbol w4x") if 'data-c' in span.attrs]

            if emojis:
                random_emoji = random.choice(emojis)
                await ctx.send(random_emoji)
            else:
                await ctx.send("No emojis found on the page.")
        
        except Exception as e:
            await ctx.send(f"An error occurred: {e}")

async def setup(bot):
    await bot.add_cog(TextEmojiCog(bot))
