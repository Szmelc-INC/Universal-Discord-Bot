import discord
from discord.ext import commands
import random
import re  # For URL detection
import asyncio  # For adding delay

class Anoncord(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        # Replace with a list of channel IDs for target channels
        self.anon_channel_ids = [
            1314503562960834571,  # Channel ID 1
            1314517087414124545,  # Channel ID 2
            # Add more channel IDs here
        ]
        self.delete_delay = 0.1  # Delay in seconds before deleting the original message

    def is_valid_url(self, url):
        # Basic URL validation
        regex = r"(http|https)://[^\s]+"
        return re.match(regex, url)

    @commands.command(name='anon', help='Send an anonymous message, file, or link to specified channels.')
    async def anonymous_message(self, ctx, *, message: str = None):
        # Add a slight delay before deleting the original message
        try:
            await asyncio.sleep(self.delete_delay)
            await ctx.message.delete()
        except discord.Forbidden:
            await ctx.send("I don't have permission to delete messages here, but sent anyway.")

        # Generate a random identifier for the anonymous message
        random_id = random.randint(1, 9999)

        # Prepare embed and files for the message
        embed = discord.Embed(description=f"### 🔏 [ANON-{random_id}] 🔏")
        file_attachments = []

        # Handle attachments (files/images)
        if ctx.message.attachments:
            for attachment in ctx.message.attachments:
                # Handle images
                if attachment.content_type and attachment.content_type.startswith("image"):
                    embed.add_field(name="📬", value=f"({attachment.url})", inline=False)
                    embed.set_image(url=attachment.url)  # Add first image to the embed preview
                else:
                    # Handle non-image files
                    file_attachments.append(await attachment.to_file())
                    embed.add_field(name="📦", value=f"[{attachment.filename}]({attachment.url})", inline=False)

        # Handle the message content
        if message:
            if self.is_valid_url(message):
                embed.add_field(name="📷", value=message, inline=False)
            else:
                embed.add_field(name="💬", value=message, inline=False)

        # Send the consolidated message to all specified channels
        if embed.fields or file_attachments:
            for channel_id in self.anon_channel_ids:
                anon_channel = self.bot.get_channel(channel_id)
                if anon_channel is None:
                    continue  # Skip if the channel is not found
                await anon_channel.send(embed=embed, files=file_attachments)
        else:
            await ctx.send("You must provide a message or attach a file/image to send.")

    @commands.command(name='anonfile', help='Alias for sending anonymous messages with files.')
    async def anonymous_file(self, ctx):
        await self.anonymous_message(ctx)

# Setup function to add the cog to the bot
async def setup(bot):
    await bot.add_cog(Anoncord(bot))
