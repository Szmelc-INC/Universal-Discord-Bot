import discord
from discord.ext import commands
from discord.utils import get

class RoleReactionCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.reaction_message_id = 1201058205514604544  # Replace with your message ID
        self.reaction_role_map = {
            '👀': 'Bozo',  # Replace with the actual emoji and role name
            '👎': 'Role2',  # Another emoji-role pair
            # Add more emoji-role pairs as needed
        }

    @commands.Cog.listener()
    async def on_ready(self):
        print(f"Logged in as {self.bot.user}")

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload):
        """Assign a role based on reaction emoji."""
        if payload.message_id == self.reaction_message_id:
            guild = self.bot.get_guild(payload.guild_id)
            if guild is None:
                return

            role_name = self.reaction_role_map.get(payload.emoji.name)
            if role_name:
                role = get(guild.roles, name=role_name)
                if role:
                    member = guild.get_member(payload.user_id)
                    if member:
                        await member.add_roles(role)

    @commands.Cog.listener()
    async def on_raw_reaction_remove(self, payload):
        """Remove a role based on reaction emoji."""
        if payload.message_id == self.reaction_message_id:
            guild = self.bot.get_guild(payload.guild_id)
            if guild is None:
                return

            role_name = self.reaction_role_map.get(payload.emoji.name)
            if role_name:
                role = get(guild.roles, name=role_name)
                if role:
                    member = guild.get_member(payload.user_id)
                    if member:
                        await member.remove_roles(role)

async def setup(bot):
    await bot.add_cog(RoleReactionCog(bot))
