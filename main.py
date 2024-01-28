import discord
import os
from discord.ext import commands

TOKEN = 'YOUR DISCORD BOT TOKEN'

class ModularBot(commands.Bot):
    def __init__(self, command_prefix, modules_folder):
        intents = discord.Intents.default()
        intents.messages = True
        intents.guilds = True
        intents.message_content = True

        super().__init__(command_prefix, intents=intents)
        self.modules_folder = modules_folder

    async def setup_hook(self):
        await self.load_modules()

    async def load_modules(self):
        for filename in os.listdir(self.modules_folder):
            if filename.endswith('.py') and not filename.startswith('__'):
                module_name = filename[:-3]
                try:
                    await self.load_extension(f"{self.modules_folder}.{module_name}")
                    print(f"Loaded module: {module_name}")
                except Exception as e:
                    print(f"Failed to load module {module_name}: {e}")

    async def on_ready(self):
        print(f'{self.user} has connected to Discord!')

bot = ModularBot(command_prefix='!', modules_folder='modules')
bot.run(TOKEN)
