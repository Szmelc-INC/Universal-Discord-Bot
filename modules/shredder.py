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
        required_role_ids = [940433614326341733, 1180412519190364202, 1308222346338893834, 1308230046632251403]  # Replace with your Admin role IDs
        has_role = any(role.id in required_role_ids for role in ctx.author.roles)
        return has_role

    @commands.command(name='rm')
    @commands.check(has_required_role)
    async def cleanup(self, ctx, target: str, time_frame: str):
        """
        Cleans up messages based on mode, time frame, and optional users.
        Usage: '!rm channel' or '!rm global' or '!rm @username [time_frame]'.
        Modes: 'user', 'channel', 'global'.
        Time frame: e.g., 30s, 15m, 2h.
        Append '--backup' to time frame to save messages before deleting.
        """
        backup = '--backup' in time_frame
        time_frame = time_frame.replace('--backup', '').strip()
        users = []
        mode = None

        # Determine the mode based on the target
        if target.lower() == 'channel':
            mode = 'channel'
        elif target.lower() == 'global':
            mode = 'global'
        else:
            # Assume it's a user mention
            try:
                users = [await commands.UserConverter().convert(ctx, target)]
                mode = 'user'
            except commands.UserNotFound:
                await ctx.send("I see no shit")
                return

        # Parse time frame
        time_dict = {'s': 1, 'm': 60, 'h': 3600}
        match = re.match(r"(\d+)([smh])$", time_frame)
        if not match:
            await ctx.send("A jakiś normalny przedział czasowy?. Format: '30s', '15m', or '2h'.")
            return

        amount, unit = match.groups()
        time_limit = datetime.now(pytz.utc) - timedelta(seconds=int(amount) * time_dict[unit])

        def check(message):
            if users and message.author not in users:
                return False
            return message.created_at > time_limit

        # Backup messages if requested
        if backup:
            await self.backup_messages(ctx, mode, check)

        # Cleanup messages with rate-limiting
        try:
            if mode == 'user' and users:
                await self.cleanup_with_delay(ctx.channel, check)
            elif mode == 'channel':
                await self.cleanup_with_delay(ctx.channel, check)
            elif mode == 'global':
                for channel in ctx.guild.text_channels:
                    await self.cleanup_with_delay(channel, check)
            else:
                await ctx.send("Nie znasz sie kurwa. sprecyzuj 'user', 'channel', lub 'global'.")
        except Exception as e:
            await ctx.send(f"Coś sie zjebało: {e}")

    async def cleanup_with_delay(self, channel, check, delay=1):
        """Deletes messages with a delay between deletions to avoid rate-limiting."""
        async for message in channel.history(limit=None):
            if check(message):
                try:
                    await message.delete()
                    await asyncio.sleep(delay)  # Prevent rate-limiting
                except discord.errors.Forbidden:
                    print(f"Nie umie {message.author}")
                except discord.errors.NotFound:
                    print(f"Ale tu nic nie ma {message.id}")

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
                        file.write(f"Backup: {attachment.filename}\n")

        try:
            await ctx.author.send("Backup completed.", file=discord.File(file_path))
        except discord.errors.Forbidden:
            await ctx.send("Halo? Jest tam kto? Nie odbierasz ode mnie poczty :(")

async def setup(bot):
    await bot.add_cog(CleanupModule(bot))
