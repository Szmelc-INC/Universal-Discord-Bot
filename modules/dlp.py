import discord
from discord.ext import commands
import subprocess
import os
import uuid

class YTDLPCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.download_path = '/home/SilverX/'  # Set your download directory path

    async def download_media(self, url, format):
        unique_id = str(uuid.uuid4())
        file_path = os.path.join(self.download_path, unique_id)

        if format == 'mp3':
            command = ['yt-dlp', '-ix', '--audio-format', 'mp3', url, '-o', f'{file_path}.%(ext)s']
        elif format == 'mp4':
            command = ['yt-dlp', '-f', 'best', url, '--recode-video', 'mp4', '-o', f'{file_path}.%(ext)s']
        else:
            return None

        try:
            subprocess.run(command, check=True, text=True, capture_output=True)
            return f'{file_path}.{format}'
        except subprocess.CalledProcessError as e:
            print("Error executing yt-dlp:", e.stderr)
            return None

    @commands.command()
    async def mp3(self, ctx, url: str):
        try:
            file_path = await self.download_media(url, 'mp3')
            if file_path and os.path.exists(file_path):
                await ctx.send(file=discord.File(file_path))
                os.remove(file_path)
            else:
                await ctx.send("Failed to download MP3.")
        except Exception as e:
            await ctx.send(f"Error: {e}")

    @commands.command()
    async def mp4(self, ctx, url: str):
        try:
            file_path = await self.download_media(url, 'mp4')
            if file_path and os.path.exists(file_path):
                await ctx.send(file=discord.File(file_path))
                os.remove(file_path)
            else:
                await ctx.send("Failed to download MP4.")
        except Exception as e:
            await ctx.send(f"Error: {e}")

async def setup(bot):
    await bot.add_cog(YTDLPCog(bot))
