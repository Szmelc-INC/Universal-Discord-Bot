import discord
from discord.ext import commands
import asyncio
import subprocess
import json

# REQUIRES FFMPEG & YT-DLP INSTALLED ON SERVER

class MusicBotCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.voice_client = None  # To store the bot's voice client
        self.queue = asyncio.Queue()  # Track queue for orderly playback
        self.is_playing = False  # Playback status

    async def play_next(self, ctx):
        """Plays the next track in the queue."""
        if not self.queue.empty():
            url = await self.queue.get()
            await self.play_url(ctx, url)
        else:
            self.is_playing = False
            await ctx.send("Playback finished. Queue is empty.")

    async def play_url(self, ctx, url):
        """Plays a given URL."""
        try:
            self.is_playing = True
            await ctx.send(f"Now playing: `{url}`")
            
            # Use yt-dlp to get the audio stream URL
            cmd = ["yt-dlp", "-f", "bestaudio", "-g", url]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            audio_url = result.stdout.strip()

            # Play the audio using FFmpeg
            self.voice_client.stop()
            self.voice_client.play(
                discord.FFmpegPCMAudio(audio_url),
                after=lambda e: asyncio.run_coroutine_threadsafe(self.play_next(ctx), self.bot.loop)
            )
        except subprocess.CalledProcessError as e:
            await ctx.send(f"Error extracting audio: {e.stderr}")
            self.is_playing = False
            await self.play_next(ctx)
        except Exception as e:
            await ctx.send(f"Error playing URL: {e}")
            self.is_playing = False
            await self.play_next(ctx)

    @commands.command()
    async def join(self, ctx):
        """Command to join the voice channel."""
        if ctx.author.voice is None:
            await ctx.send("You need to be in a voice channel to summon the bot!")
            return

        channel = ctx.author.voice.channel
        self.voice_client = await channel.connect()
        await ctx.send(f"Joined {channel}.")

    @commands.command()
    async def leave(self, ctx):
        """Command to leave the voice channel."""
        if self.voice_client is not None:
            await self.voice_client.disconnect()
            self.voice_client = None
            await ctx.send("Left the voice channel.")
        else:
            await ctx.send("I'm not connected to any voice channel.")

    @commands.command()
    async def play(self, ctx, url: str):
        """Play a YouTube video or playlist."""
        if self.voice_client is None:
            await ctx.send("I'm not connected to a voice channel. Use `!join` first.")
            return

        await ctx.send("Processing URL...")

        try:
            # Check if the URL is a playlist or a single video
            cmd = ["yt-dlp", "--flat-playlist", "-J", url]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            playlist_info = json.loads(result.stdout)  # Parse JSON output safely

            if "entries" in playlist_info:  # Playlist detected
                await ctx.send(f"Adding playlist `{playlist_info['title']}` to the queue.")
                for video in playlist_info["entries"]:
                    await self.queue.put(video["url"])
            else:  # Single video
                await self.queue.put(url)

            if not self.is_playing:
                await self.play_next(ctx)
        except subprocess.CalledProcessError as e:
            await ctx.send(f"Error processing URL: {e.stderr}")
        except Exception as e:
            await ctx.send(f"Unexpected error: {e}")

    @commands.command()
    async def stop(self, ctx):
        """Stop the current audio and clear the queue."""
        if self.voice_client is not None and self.voice_client.is_playing():
            self.voice_client.stop()
            while not self.queue.empty():
                self.queue.get_nowait()
            self.is_playing = False
            await ctx.send("Stopped the audio and cleared the queue.")
        else:
            await ctx.send("No audio is playing.")

    @commands.command()
    async def skip(self, ctx):
        """Skip the current track."""
        if self.voice_client is not None and self.voice_client.is_playing():
            self.voice_client.stop()
            await ctx.send("Skipped the current track.")
        else:
            await ctx.send("No audio is playing.")

    @commands.command()
    async def queue(self, ctx):
        """Show the current queue."""
        if not self.queue.empty():
            queue_list = list(self.queue._queue)  # Get all items in the queue
            await ctx.send(f"Current queue: {', '.join(queue_list[:5])}... ({len(queue_list)} total)")
        else:
            await ctx.send("The queue is empty.")

async def setup(bot):
    cog = MusicBotCog(bot)
    await bot.add_cog(cog)
