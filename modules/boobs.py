import discord
from discord.ext import commands
import requests
from bs4 import BeautifulSoup
import re
import time

class Boobs(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_ready(self):
        print(f"Logged in as {self.bot.user}")

    @commands.command()
    async def cycki(self, ctx):
        # Replace with your specific server and channel IDs
        ALLOWED_SERVER_ID = 940431029037072416  # Replace with your server ID
        ALLOWED_CHANNEL_ID = 1170861145066836078  # Replace with your channel ID

        # Check if the command is used in a server and if it's the specified server and channel
        if ctx.guild is not None:
            if ctx.guild.id != ALLOWED_SERVER_ID or ctx.channel.id != ALLOWED_CHANNEL_ID:
                return  # Ignore if not in the specified server and channel

        max_retries = 5
        for _ in range(max_retries):
            try:
                response = requests.get("https://zmarsa.com/losowe")
                soup = BeautifulSoup(response.content, 'html.parser')

                # Updated pattern to match zmarsa.com image URLs
                pattern = re.compile(r'https://zmarsa\.com/storage/image/[a-zA-Z0-9/-]+\.jpg')
                meme_element = soup.find('img', {'class': 'post-image', 'src': pattern})
                meme_url = meme_element['src'] if meme_element else None

                title_element = soup.find('meta', {'property': 'og:title'})
                title = title_element['content'] if title_element else "Random Meme"

                if meme_url:
                    embed = discord.Embed(title=title)
                    embed.set_image(url=meme_url)
                    await ctx.send(embed=embed)
                    return  # Meme found, exit the function

            except Exception as e:
                print(f"Error fetching meme: {e}")  # Print the error for debugging

            time.sleep(1)  # Optional: Sleep for a short time before retrying

        # If no meme is found after all retries
        await ctx.send("Unable to find a meme after several attempts.")

async def setup(bot):
    await bot.add_cog(Boobs(bot))
