import discord
import os
from discord.ext import commands

class DMLoggerCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.log_folder = 'dm'

    @commands.Cog.listener()
    async def on_ready(self):
        if not os.path.exists(self.log_folder):
            os.makedirs(self.log_folder)

    @commands.Cog.listener()
    async def on_message(self, message):
        if isinstance(message.channel, discord.DMChannel):
            user_id = message.author.id
            log_file_path = os.path.join(self.log_folder, f'{user_id}.txt')

            with open(log_file_path, 'a') as log_file:
                if message.author == self.bot.user:
                    log_file.write(f"{self.bot.user.name}: {message.content}\n")
                else:
                    log_file.write(f"{message.author.name}: {message.content}\n")

async def setup(bot):
    await bot.add_cog(DMLoggerCog(bot))
