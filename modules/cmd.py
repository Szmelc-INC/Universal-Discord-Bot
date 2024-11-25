import discord
from discord.ext import commands
import subprocess

class ShellExecCog1(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.allowed_commands = {
            "figlet": ["figlet"],
            "toilet": ["toilet"],
            "cowsay": ["cowsay"],
            "fortune": ["fortune"],
            "uptime": ["uptime"]
            
        }

    async def execute_allowed_command(self, command, args):
        if command in self.allowed_commands:
            process = subprocess.Popen(self.allowed_commands[command] + args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=(command == "dir"))
            stdout, stderr = process.communicate()
            return stdout.decode() or stderr.decode()
        return None

    @commands.command()
    async def cmd(self, ctx, *, command: str):
        command_parts = command.split()
        base_command = command_parts[0]
        args = command_parts[1:]

        # Check if the base command is in the dictionary of allowed commands
        if base_command in self.allowed_commands:
            response = await self.execute_allowed_command(base_command, args)
            if response is not None:
                await ctx.send(f"```{response}```")
            else:
                await ctx.send("An error occurred while executing the command.")
        else:
            await ctx.send("This command is not allowed.")

async def setup(bot):
    await bot.add_cog(ShellExecCog1(bot))
