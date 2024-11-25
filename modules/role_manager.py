import discord
from discord.ext import commands

class RoleManagerCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.allowed_user_id = 818166724641030193  # Replace with your Discord user ID

    @commands.command()
    async def addrole(self, ctx, member: discord.Member, *, role: discord.Role):
        """Adds a role to a member."""
        if ctx.author.id != self.allowed_user_id:
            await ctx.send("You are not authorized to use this command.")
            return

        if role in member.roles:
            await ctx.send(f"{member.display_name} already has the role {role.name}.")
            return

        try:
            await member.add_roles(role)
            await ctx.send(f"Successfully added role {role.name} to {member.display_name}.")
        except discord.Forbidden:
            await ctx.send("I do not have permission to add this role.")
        except Exception as e:
            await ctx.send(f"An error occurred: {e}")

    @commands.command()
    async def removerole(self, ctx, member: discord.Member, *, role: discord.Role):
        """Removes a role from a member."""
        if ctx.author.id != self.allowed_user_id:
            await ctx.send("You are not authorized to use this command.")
            return

        if role not in member.roles:
            await ctx.send(f"{member.display_name} does not have the role {role.name}.")
            return

        try:
            await member.remove_roles(role)
            await ctx.send(f"Successfully removed role {role.name} from {member.display_name}.")
        except discord.Forbidden:
            await ctx.send("I do not have permission to remove this role.")
        except Exception as e:
            await ctx.send(f"An error occurred: {e}")

    @commands.command()
    async def listroles(self, ctx, member: discord.Member):
        """Lists all roles of a member."""
        if ctx.author.id != self.allowed_user_id:
            await ctx.send("You are not authorized to use this command.")
            return

        roles = [role.name for role in member.roles if role.name != "@everyone"]
        if roles:
            await ctx.send(f"{member.display_name} has the following roles: {', '.join(roles)}")
        else:
            await ctx.send(f"{member.display_name} has no roles.")

async def setup(bot):
    await bot.add_cog(RoleManagerCog(bot))
