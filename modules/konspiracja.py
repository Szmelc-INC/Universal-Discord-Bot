import discord
from discord.ext import commands
import datetime

class KonspiracjaCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def delete_recent_messages(self, channel, duration=60):
        """Delete messages from the last `duration` seconds."""
        now = discord.utils.utcnow()
        async for message in channel.history(limit=100):
            if (now - message.created_at).total_seconds() < duration:
                await message.delete()

    @commands.command()
    @commands.has_permissions(administrator=True)
    async def konspiracja(self, ctx):
        # Delete recent messages in all channels
        for channel in ctx.guild.text_channels:
            await self.delete_recent_messages(channel)

        await ctx.send("Konspiracja activated! Recent messages have been deleted.", delete_after=10)

async def setup(bot):
    await bot.add_cog(KonspiracjaCog(bot))
