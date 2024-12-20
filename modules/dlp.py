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
        self.max_size = 10 * 1024 * 1024 * 1024  # 10GB in bytes
        self.min_discord_upload_size = 10 * 1024 * 1024  # 10MB in bytes

    async def get_video_info(self, url):
        """Fetch video information using yt-dlp."""
        command = ['yt-dlp', '--dump-json', '--rm-cache-dir', url]
        if os.path.exists(self.cookies_file):
            command.extend(['--cookies', self.cookies_file])
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=True)
            return json.loads(result.stdout)
        except subprocess.CalledProcessError as e:
            print("Error getting video info:", e.stderr)
            return None

    async def download_media(self, url, format):
        """Download the media file."""
        video_info = await self.get_video_info(url)
        if not video_info:
            return None, "Failed to fetch video info."

        file_size = video_info.get('filesize_approx', 0)
        if file_size > self.max_size:
            return None, f"File size exceeds the 10GB limit (size: {file_size / (1024**3):.2f} GB)."

        unique_id = str(uuid.uuid4())
        file_path = os.path.join(self.download_path, unique_id)

        command = ['yt-dlp', '--rm-cache-dir']
        if os.path.exists(self.cookies_file):
            command.extend(['--cookies', self.cookies_file])

        if format == 'mp3':
            command.extend(['--extract-audio', '--audio-format', 'mp3', '-o', f'{file_path}.%(ext)s', url])
        elif format == 'mp4':
            command.extend(['-f', 'bv+ba/b', '--merge-output-format', 'mp4', '-o', f'{file_path}.%(ext)s', url])
        else:
            return None, "Invalid format."

        try:
            subprocess.run(command, check=True, text=True, capture_output=True)
            return f'{file_path}.{format}', None
        except subprocess.CalledProcessError as e:
            print("Error executing yt-dlp:", e.stderr)
            return None, "Error downloading media."

    async def handle_large_file(self, ctx, file_path):
        """Handle files larger than Discord's upload limit."""
        try:
            await ctx.send("This file is large and will take longer to upload. Please wait...")
            command = ['curl', '-T', file_path, 'https://bashupload.com']
            result = subprocess.run(command, capture_output=True, text=True, check=True)
            output = result.stdout.strip()
            return output
        except subprocess.CalledProcessError as e:
            print("Error uploading file to bashupload:", e.stderr)
            return "Failed to upload file to bashupload."

    @commands.command()
    async def mp3(self, ctx, url: str):
        """Download audio as MP3 (up to 10GB)."""
        try:
            file_path, error = await self.download_media(url, 'mp3')
            if error:
                await ctx.send(error)
            elif file_path and os.path.exists(file_path):
                file_size = os.path.getsize(file_path)
                if file_size <= self.min_discord_upload_size:
                    await ctx.send(file=discord.File(file_path))
                else:
                    upload_link = await self.handle_large_file(ctx, file_path)
                    await ctx.send(f"File uploaded to BashUpload: {upload_link}")
                os.remove(file_path)
            else:
                await ctx.send("Failed to download MP3.")
        except Exception as e:
            await ctx.send(f"Error: {e}")

    @commands.command()
    async def mp4(self, ctx, url: str):
        """Download video as MP4 (up to 10GB)."""
        try:
            file_path, error = await self.download_media(url, 'mp4')
            if error:
                await ctx.send(error)
            elif file_path and os.path.exists(file_path):
                file_size = os.path.getsize(file_path)
                if file_size <= self.min_discord_upload_size:
                    await ctx.send(file=discord.File(file_path))
                else:
                    upload_link = await self.handle_large_file(ctx, file_path)
                    await ctx.send(f"File uploaded to BashUpload: {upload_link}")
                os.remove(file_path)
            else:
                await ctx.send("Failed to download MP4.")
        except Exception as e:
            await ctx.send(f"Error: {e}")

async def setup(bot):
    await bot.add_cog(YTDLPCog(bot))
