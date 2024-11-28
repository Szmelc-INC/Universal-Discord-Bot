import discord
from discord.ext import commands
import subprocess
import os
import uuid
import json

class YTDLPCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.download_path = '.Downloads'  # Set your download directory path
        self.cookies_file = 'cookies.txt'  # Cookies file path
        self.max_duration = 600  # 10 minutes in seconds

    async def get_video_info(self, url):
        """Fetch video information using yt-dlp."""
        command = ['yt-dlp', '--dump-json', url]
        if os.path.exists(self.cookies_file):
            command.extend(['--cookies', self.cookies_file])
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=True)
            return json.loads(result.stdout)
        except subprocess.CalledProcessError as e:
            print("Error getting video info:", e.stderr)
            return None

    async def download_media(self, url, format):
        """Download the media after checking duration."""
        # Fetch video info
        video_info = await self.get_video_info(url)
        if not video_info:
            return None, "Failed to fetch video info."

        duration = video_info.get('duration', 0)
        if duration > self.max_duration:
            return None, f"Video duration exceeds 10 minutes (duration: {duration // 60} minutes)."

        # Generate unique file path
        unique_id = str(uuid.uuid4())
        file_path = os.path.join(self.download_path, unique_id)

        # Build download command
        command = ['yt-dlp']
        if os.path.exists(self.cookies_file):
            command.extend(['--cookies', self.cookies_file])

        if format == 'mp3':
            command.extend(['-ix', '--audio-format', 'mp3', '-o', f'{file_path}.%(ext)s', url])
        elif format == 'mp4':
            command.extend(['-f', 'best', '--recode-video', 'mp4', '-o', f'{file_path}.%(ext)s', url])
        else:
            return None, "Invalid format."

        try:
            subprocess.run(command, check=True, text=True, capture_output=True)
            return f'{file_path}.{format}', None
        except subprocess.CalledProcessError as e:
            print("Error executing yt-dlp:", e.stderr)
            return None, "Error downloading media."

    @commands.command()
    async def mp3(self, ctx, url: str):
        """Download audio as MP3 (up to 10 minutes long)."""
        try:
            file_path, error = await self.download_media(url, 'mp3')
            if error:
                await ctx.send(error)
            elif file_path and os.path.exists(file_path):
                await ctx.send(file=discord.File(file_path))
                os.remove(file_path)
            else:
                await ctx.send("Failed to download MP3.")
        except Exception as e:
            await ctx.send(f"Error: {e}")

    @commands.command()
    async def mp4(self, ctx, url: str):
        """Download video as MP4 (up to 10 minutes long)."""
        try:
            file_path, error = await self.download_media(url, 'mp4')
            if error:
                await ctx.send(error)
            elif file_path and os.path.exists(file_path):
                await ctx.send(file=discord.File(file_path))
                os.remove(file_path)
            else:
                await ctx.send("Failed to download MP4.")
        except Exception as e:
            await ctx.send(f"Error: {e}")

async def setup(bot):
    await bot.add_cog(YTDLPCog(bot))
