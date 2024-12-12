import discord
from discord.ext import commands
import asyncio
import subprocess
import json
import os
from googleapiclient.discovery import build

class MusicBotCog(commands.Cog):
    def __init__(self, bot, youtube_api_key):
        self.bot = bot
        self.server_sessions = {}  # Tracks playback sessions per server
        self.server_queues = {}    # Tracks queues for each server
        self.cookies_path = "cookies.txt"  # Path to cookies file
        self.youtube_api_key = youtube_api_key  # API key for YouTube Data API

        # Create a YouTube API client
        self.youtube = build('youtube', 'v3', developerKey=self.youtube_api_key)

    async def play_next(self, guild_id, ctx):
        """Plays the next track in the queue for a server."""
        if guild_id not in self.server_queues or self.server_queues[guild_id].empty():
            if guild_id in self.server_sessions:
                self.server_sessions[guild_id]['is_playing'] = False
            await ctx.send("Playback finished. Queue is empty.")
            return

        url = await self.server_queues[guild_id].get()
        await self.play_url(ctx, guild_id, url)

    async def play_url(self, ctx, guild_id, url):
        """Plays a given URL for a server."""
        try:
            session = self.server_sessions[guild_id]
            session['is_playing'] = True
            await ctx.send(f"Now playing: `{url}`")
            
            # Use yt-dlp with cookies to get the audio stream URL
            cmd = ["yt-dlp", "--cookies", self.cookies_path, "-f", "bestaudio", "-g", url]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            audio_url = result.stdout.strip()

            # Play the audio using FFmpeg
            session['voice_client'].stop()
            session['voice_client'].play(
                discord.FFmpegPCMAudio(audio_url),
                after=lambda e: asyncio.run_coroutine_threadsafe(
                    self.play_next(guild_id, ctx), self.bot.loop
                )
            )
        except subprocess.CalledProcessError as e:
            await ctx.send(f"Error extracting audio: {e.stderr}")
            await self.play_next(guild_id, ctx)
        except Exception as e:
            await ctx.send(f"Error playing URL: {e}")
            await self.play_next(guild_id, ctx)

    @commands.command()
    async def join(self, ctx):
        """Command to join the voice channel."""
        if ctx.author.voice is None:
            await ctx.send("You need to be in a voice channel to summon the bot!")
            return

        guild_id = ctx.guild.id
        channel = ctx.author.voice.channel
        voice_client = await channel.connect()
        
        self.server_sessions[guild_id] = {
            'voice_client': voice_client,
            'is_playing': False
        }
        self.server_queues[guild_id] = asyncio.Queue()
        await ctx.send(f"Joined {channel}.")

    @commands.command()
    async def leave(self, ctx):
        """Command to leave the voice channel."""
        guild_id = ctx.guild.id
        if guild_id in self.server_sessions:
            await self.server_sessions[guild_id]['voice_client'].disconnect()
            del self.server_sessions[guild_id]
            del self.server_queues[guild_id]
            await ctx.send("Left the voice channel.")
        else:
            await ctx.send("I'm not connected to any voice channel.")

    @commands.command()
    async def play(self, ctx, url: str):
        """Play a YouTube video or playlist."""
        guild_id = ctx.guild.id
        if guild_id not in self.server_sessions:
            await ctx.send("I'm not connected to a voice channel. Use `!join` first.")
            return

        await ctx.send("Processing URL...")

        try:
            # Use yt-dlp with cookies to process the URL
            cmd = ["yt-dlp", "--cookies", self.cookies_path, "--flat-playlist", "-J", url]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            playlist_info = json.loads(result.stdout)

            if "entries" in playlist_info:  # Playlist detected
                await ctx.send(f"Adding playlist `{playlist_info['title']}` to the queue.")
                for video in playlist_info["entries"]:
                    await self.server_queues[guild_id].put(video["url"])
            else:  # Single video
                await self.server_queues[guild_id].put(url)

            if not self.server_sessions[guild_id]['is_playing']:
                await self.play_next(guild_id, ctx)
        except subprocess.CalledProcessError as e:
            await ctx.send(f"Error processing URL: {e.stderr}")
        except Exception as e:
            await ctx.send(f"Unexpected error: {e}")

    @commands.command()
    async def pause(self, ctx):
        """Pause playback."""
        guild_id = ctx.guild.id
        if guild_id in self.server_sessions:
            session = self.server_sessions[guild_id]
            if session['voice_client'].is_playing():
                session['voice_client'].pause()
                await ctx.send("Paused playback.")
            else:
                await ctx.send("No audio is playing.")
        else:
            await ctx.send("I'm not connected to a voice channel.")

    @commands.command()
    async def resume(self, ctx):
        """Resume playback."""
        guild_id = ctx.guild.id
        if guild_id in self.server_sessions:
            session = self.server_sessions[guild_id]
            if session['voice_client'].is_paused():
                session['voice_client'].resume()
                await ctx.send("Resumed playback.")
            else:
                await ctx.send("Audio is not paused.")
        else:
            await ctx.send("I'm not connected to a voice channel.")

    @commands.command()
    async def stop(self, ctx):
        """Stop the current audio and clear the queue."""
        guild_id = ctx.guild.id
        if guild_id in self.server_sessions:
            session = self.server_sessions[guild_id]
            session['voice_client'].stop()
            while not self.server_queues[guild_id].empty():
                self.server_queues[guild_id].get_nowait()
            session['is_playing'] = False
            await ctx.send("Stopped the audio and cleared the queue.")
        else:
            await ctx.send("I'm not connected to a voice channel.")

    @commands.command()
    async def skip(self, ctx):
        """Skip the current track."""
        guild_id = ctx.guild.id
        if guild_id in self.server_sessions and self.server_sessions[guild_id]['voice_client'].is_playing():
            self.server_sessions[guild_id]['voice_client'].stop()
            await ctx.send("Skipped the current track.")
        else:
            await ctx.send("No audio is playing.")

    @commands.command()
    async def queue(self, ctx):
        """Show the current queue."""
        guild_id = ctx.guild.id
        if guild_id in self.server_queues and not self.server_queues[guild_id].empty():
            queue_list = list(self.server_queues[guild_id]._queue)
            await ctx.send(f"Current queue: {', '.join(queue_list[:5])}... ({len(queue_list)} total)")
        else:
            await ctx.send("The queue is empty.")
    
    @commands.command()
    async def search(self, ctx, *, query: str):
        """Search YouTube for a video and play the first result."""
        # Search for the query on YouTube
        try:
            search_response = self.youtube.search().list(
                q=query,
                part='snippet',
                type='video',
                maxResults=1
            ).execute()

            if search_response['items']:
                video = search_response['items'][0]
                video_url = f"https://www.youtube.com/watch?v={video['id']['videoId']}"
                await ctx.send(f"Found: {video['snippet']['title']} - {video_url}")

                # Play the video
                await self.play_url(ctx, ctx.guild.id, video_url)
            else:
                await ctx.send("No results found.")
        except Exception as e:
            await ctx.send(f"Error searching YouTube: {e}")

async def setup(bot):
    youtube_api_key = os.getenv('YOUTUBE_API_KEY')  # Set your YouTube API key in an environment variable
    cog = MusicBotCog(bot, youtube_api_key)
    await bot.add_cog(cog)
