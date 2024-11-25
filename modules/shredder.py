import discord
from discord.ext import commands
from datetime import datetime, timedelta
import pytz
import os
import re
import asyncio

class CleanupModule(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def has_required_role(ctx):
        required_role_id = 1180412519190364202  # Replace with your Admin role ID
        has_role = any(role.id == required_role_id for role in ctx.author.roles)
        return has_role

    @commands.command(name='rm')
    @commands.check(has_required_role)
    async def cleanup(self, ctx, mode: str, time_frame: str, *, extra: str = ""):
        """
        Cleans up messages based on mode, time frame, and optional user.
        Modes: 'user', 'channel', 'global'.
        Time frame: e.g., 30s, 15m, 2h.
        Append '--backup' to time frame to save messages before deleting.
        For user mode, mention the user followed by the time frame.
        """
        backup = '--backup' in extra
        user = None

        # Parse user and time frame for 'user' mode
        if mode == 'user':
            try:
                user = await commands.UserConverter().convert(ctx, extra.split(' ')[0])
                time_frame = extra.split(' ')[1] if len(extra.split(' ')) > 1 else time_frame
            except commands.UserNotFound:
                await ctx.send("User not found.")
                return

        # Parse time frame
        time_dict = {'s': 1, 'm': 60, 'h': 3600}
        match = re.match(r"(\d+)([smh])$", time_frame)
        if not match:
            await ctx.send("Invalid time frame. Format should be like '30s', '15m', or '2h'.")
            return

        amount, unit = match.groups()
        time_limit = datetime.now(pytz.utc) - timedelta(seconds=int(amount) * time_dict[unit])

        def check(message):
            if user and message.author != user:
                return False
            return message.created_at > time_limit

        # Backup messages if requested
        if backup:
            await self.backup_messages(ctx, mode, check)

        # Cleanup messages with rate-limiting
        try:
            if mode == 'user' and user:
                await self.cleanup_with_delay(ctx.channel, check)
            elif mode == 'channel':
                await self.cleanup_with_delay(ctx.channel, check)
            elif mode == 'global':
                for channel in ctx.guild.text_channels:
                    await self.cleanup_with_delay(channel, check)
            else:
                await ctx.send("Invalid mode. Please use 'user', 'channel', or 'global'.")
        except Exception as e:
            await ctx.send(f"An error occurred: {e}")

    async def cleanup_with_delay(self, channel, check, delay=1):
        """Deletes messages with a delay between deletions to avoid rate-limiting."""
        async for message in channel.history(limit=None):
            if check(message):
                try:
                    await message.delete()
                    await asyncio.sleep(delay)  # Prevent rate-limiting
                except discord.errors.Forbidden:
                    print(f"Permission error: Unable to delete message from {message.author}")
                except discord.errors.NotFound:
                    print(f"Message already deleted: {message.id}")

    async def backup_messages(self, ctx, mode, check):
        """Backs up messages before deletion."""
        backup_folder = "backup"
        os.makedirs(backup_folder, exist_ok=True)
        file_path = os.path.join(
            backup_folder,
            f"{ctx.guild.id}_{ctx.channel.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        )

        with open(file_path, 'w', encoding='utf-8') as file:
            async for message in ctx.channel.history(limit=None):
                if check(message):
                    content = f"{message.created_at} - {message.author.display_name}: {message.content}\n"
                    file.write(content)
                    for attachment in message.attachments:
                        attachment_path = os.path.join(backup_folder, attachment.filename)
                        await attachment.save(attachment_path)
                        file.write(f"Attachment saved: {attachment.filename}\n")

        try:
            await ctx.author.send("Backup completed.", file=discord.File(file_path))
        except discord.errors.Forbidden:
            await ctx.send("I couldn't send you a DM. Please check your DM settings.")

async def setup(bot):
    await bot.add_cog(CleanupModule(bot))
