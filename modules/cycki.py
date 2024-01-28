import discord
from discord.ext import commands
import requests
from bs4 import BeautifulSoup
import re
import time

class ImageFetcher(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_ready(self):
        print(f"Logged in as {self.bot.user}")

    @commands.command()
    async def cycki(self, ctx):
        max_retries = 5
        for _ in range(max_retries):
            try:
                response = requests.get("https://zmarsa.com/losowe", timeout=5)
                if response.status_code != 200:
                    continue  # Skip if the response is not successful

                soup = BeautifulSoup(response.content, 'html.parser')
                pattern = re.compile(r'https://zmarsa\.com/storage/image/[a-zA-Z0-9/-]+\.jpg')
                image_element = soup.find('img', {'class': 'post-image', 'src': pattern})
                image_url = image_element['src'] if image_element else None

                if image_url:
                    embed = discord.Embed(title="Losowe Witajki")
                    embed.set_image(url=image_url)
                    await ctx.send(embed=embed)
                    return  # Image found, exit the function

            except requests.RequestException as e:
                print(f"Error fetching image: {e}")

            time.sleep(1)  # Sleep for a short time before retrying

        # If no image is found after all retries
        await ctx.send("Unable to find an image after several attempts.")

async def setup(bot):
    await bot.add_cog(ImageFetcher(bot))
