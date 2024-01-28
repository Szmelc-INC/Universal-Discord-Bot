import discord
from discord.ext import commands
import subprocess

class ShellExecCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.allowed_user_id = USER_ID  # Replace with the Discord ID of the authorized user

    @commands.command()
    async def shell(self, ctx, *, command: str):
        if ctx.author.id != self.allowed_user_id:
            await ctx.send("You are not authorized to use this command.")
            return

        try:
            process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, stderr = process.communicate()
            response = stdout.decode() or stderr.decode()
            await ctx.send(f"```{response}```")
        
        except Exception as e:
            await ctx.send(f"An error occurred: {e}")

async def setup(bot):
    await bot.add_cog(ShellExecCog(bot))
