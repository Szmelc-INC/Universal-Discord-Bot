import discord
from discord.ext import commands
import requests
from bs4 import BeautifulSoup
import re
import time

# *Module to fetch furry porn ¯\_(ツ)_/¯* 
# (Universal bot, means even for furries... and all and any modules are basically all and any you can think of)
# *Allows user to specify search query by adding query after command like `!furry femboy`*

class FurryFetcher(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_ready(self):
        print(f"Logged in as {self.bot.user}")

    @commands.command()
    async def furry(self, ctx, *, query: str = None):
        max_retries = 5
        
        # Domyślne zapytanie, jeśli użytkownik nie poda żadnego
        default_query = "female+order%3Arandom+~breast_focus+~breast_grab+~breast_squish+~holding_breast+~bouncing_breasts+~breast_play+~flashing_breasts+~presenting_breasts+solo+score%3A%3E200+-rating%3As+-webm+-flash+-feral+-young"
        search_query = query if query else default_query

        headers = {
            "User-Agent": "Discord Bot (https://your-bot-url.com)",
            "Accept": "text/html"
        }

        for _ in range(max_retries):
            try:
                response = requests.get(f"https://e621.net/posts?tags={search_query}", headers=headers, timeout=5)
                if response.status_code != 200:
                    continue  # Skip if the response is not successful

                soup = BeautifulSoup(response.content, 'html.parser')
                # Find all 'a' tags with href starting with '/posts/' and containing 'img' or 'video' tags
                post_elements = soup.find_all('a', href=re.compile(r'^/posts/\d+'))
                
                for post_element in post_elements:
                    # Attempt to find the direct source image URL
                    direct_image_url = None
                    image_page_url = f"https://e621.net{post_element['href']}"
                    
                    # Fetch the image page to get the direct image URL
                    image_page_response = requests.get(image_page_url, headers=headers, timeout=5)
                    if image_page_response.status_code == 200:
                        image_page_soup = BeautifulSoup(image_page_response.content, 'html.parser')
                        
                        # Look for direct image link in full size
                        direct_image_element = image_page_soup.find('a', href=re.compile(r'^https://static1\.e621\.net/data/[a-z0-9]{2}/[a-z0-9]{2}/[a-z0-9]{32}\.(jpg|jpeg|png|gif|webp|mp4|webm)'))
                        if direct_image_element:
                            direct_image_url = direct_image_element['href']
                    
                    if direct_image_url:
                        # Found a direct source image
                        if direct_image_url.endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                            embed = discord.Embed(title="Losowe Witajki")
                            embed.set_image(url=direct_image_url)
                            await ctx.send(embed=embed)
                        else:
                            # For video files, just send the link
                            await ctx.send(f"Here is a video: {direct_image_url}")
                        return  # Direct image or video found, exit the function

            except requests.RequestException as e:
                print(f"Error fetching content: {e}")

            time.sleep(1)  # Sleep for a short time before retrying

        # If no image or video is found after all retries
        await ctx.send("Unable to find content after several attempts.")

async def setup(bot):
    await bot.add_cog(FurryFetcher(bot))
