import discord
from discord.ext import commands
import re

class AdminDMCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.admin_user_id = 818166724641030193  # Replace with the admin's Discord user ID

    @commands.command(name='dm')
    async def send_dm(self, ctx, user: str, *, message_content: str):
        if ctx.author.id != self.admin_user_id:
            await ctx.send("You are not authorized to use this command.")
            return

        try:
            # Check if the input is a mention or a raw user ID
            mention_match = re.match(r"<@!?(\d+)>", user)
            if mention_match:
                user_id = int(mention_match.group(1))  # Extract user ID from mention
            else:
                user_id = int(user)  # Assume raw user ID is provided

            # Fetch and send the DM
            user_obj = await self.bot.fetch_user(user_id)
            if user_obj:
                await user_obj.send(message_content)
                await ctx.send(f"Message sent to user {user_obj}: {message_content}")
            else:
                await ctx.send("User not found.")
        except ValueError:
            await ctx.send("Invalid user ID or mention. Please provide a valid mention or numeric user ID.")
        except Exception as e:
            await ctx.send(f"An error occurred: {e}")

async def setup(bot):
    await bot.add_cog(AdminDMCog(bot))
