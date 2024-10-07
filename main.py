import discord
from discord.ext import commands
import os
import json
import argparse
import asyncio

class ModularBot(commands.Bot):
    def __init__(self, token, command_prefix, modules_folder, enabled_modules=None):
        intents = discord.Intents.default()
        intents.messages = True
        intents.guilds = True
        intents.message_content = True

        super().__init__(command_prefix, intents=intents)
        self.token = token
        self.modules_folder = modules_folder
        self.enabled_modules = enabled_modules or []

    async def setup_hook(self):
        await self.load_modules()

    async def load_modules(self):
        # Load all .py modules in the specified folder, except for __init__.py
        for filename in os.listdir(self.modules_folder):
            if filename.endswith('.py') and not filename.startswith('__'):
                module_name = filename[:-3]  # Strip the .py extension to get the module name
                if not self.enabled_modules or module_name in self.enabled_modules:
                    try:
                        await self.load_extension(f"{self.modules_folder}.{module_name}")
                        print(f"Loaded module: {module_name}")
                    except Exception as e:
                        print(f"Failed to load module {module_name}: {e}")

    async def on_ready(self):
        print(f'{self.user} has connected to Discord!')


class BotManager:
    def __init__(self, config_file):
        with open(config_file, 'r') as f:
            self.config = json.load(f)
        self.bots = {}

    async def start_bot(self, bot_name):
        if bot_name in self.bots:
            print(f"Bot {bot_name} is already running.")
            return
        if bot_name not in self.config:
            print(f"Bot {bot_name} not found in configuration.")
            return

        bot_config = self.config[bot_name]
        bot = ModularBot(bot_config["token"], bot_config["command_prefix"], bot_config["modules_folder"], bot_config.get("enabled_modules"))
        self.bots[bot_name] = bot

        # Run the bot in an async-safe way
        await bot.start(bot_config["token"])

    async def stop_bot(self, bot_name):
        if bot_name in self.bots:
            bot = self.bots.pop(bot_name)
            await bot.close()
            print(f"Bot {bot_name} has been stopped.")
        else:
            print(f"No bot running with name {bot_name}.")

    async def restart_bot(self, bot_name):
        await self.stop_bot(bot_name)
        await self.start_bot(bot_name)

    def list_bots(self):
        bots = list(self.config.keys())
        for index, bot_name in enumerate(bots, start=1):
            print(f"{index}. {bot_name}")
        choice = int(input("Select a bot: ")) - 1
        if 0 <= choice < len(bots):
            return bots[choice]
        else:
            print("Invalid selection.")
            return None

    async def menu(self):
        while True:
            print("\nBot Manager Menu")
            print("1. Start bot")
            print("2. Stop bot")
            print("3. Restart bot")
            print("4. Exit")
            choice = input("Enter your choice: ")
            if choice in ["1", "2", "3"]:
                bot_name = self.list_bots()
                if bot_name:
                    if choice == "1":
                        await self.start_bot(bot_name)
                    elif choice == "2":
                        await self.stop_bot(bot_name)
                    elif choice == "3":
                        await self.restart_bot(bot_name)
            elif choice == "4":
                print("Exiting...")
                break
            else:
                print("Invalid choice.")

if __name__ == "__main__":
    # Argument parsing for command-line bot selection
    parser = argparse.ArgumentParser(description="Discord Bot Manager")
    parser.add_argument('bot_name', nargs='?', help="Name of the bot to start")
    args = parser.parse_args()

    manager = BotManager("config.json")

    if args.bot_name:
        # If a bot name is passed via command-line, start that bot
        bot_name = args.bot_name
        if bot_name in manager.config:
            print(f"Starting bot {bot_name}...")

            # Use asyncio to properly handle async bot start
            asyncio.run(manager.start_bot(bot_name))
        else:
            print(f"Bot {bot_name} not found in configuration.")
    else:
        # Otherwise, show the menu (in an async way)
        asyncio.run(manager.menu())
