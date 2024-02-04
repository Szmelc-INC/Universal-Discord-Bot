import discord
from discord.ext import commands
import os
import json
import threading
from concurrent.futures import ThreadPoolExecutor

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
        for filename in os.listdir(self.modules_folder):
            if filename.endswith('.py') and not filename.startswith('__'):
                module_name = filename[:-3]
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
        self.executor = ThreadPoolExecutor(max_workers=len(self.config))

    def list_bots(self):
        bots = list(self.config.keys())
        for index, bot_name in enumerate(bots, start=1):
            print(f"{index}. {bot_name}")
        choice = int(input("Select a bot: ")) - 1
        if choice >= 0 and choice < len(bots):
            return bots[choice]
        else:
            print("Invalid selection.")
            return None

    def start_bot(self, bot_name):
        if bot_name in self.bots:
            print(f"Bot {bot_name} is already running.")
            return
        bot_config = self.config[bot_name]
        bot = ModularBot(bot_config["token"], bot_config["command_prefix"], bot_config["modules_folder"], bot_config.get("enabled_modules"))
        self.bots[bot_name] = bot
        self.executor.submit(bot.run, bot_config["token"])

    def stop_bot(self, bot_name):
        if bot_name in self.bots:
            bot = self.bots.pop(bot_name)
            bot.loop.call_soon_threadsafe(bot.close)
            print(f"Bot {bot_name} has been stopped.")
        else:
            print(f"No bot running with name {bot_name}.")

    def restart_bot(self, bot_name):
        self.stop_bot(bot_name)
        self.start_bot(bot_name)

    def menu(self):
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
                        self.start_bot(bot_name)
                    elif choice == "2":
                        self.stop_bot(bot_name)
                    elif choice == "3":
                        self.restart_bot(bot_name)
            elif choice == "4":
                print("Exiting...")
                break
            else:
                print("Invalid choice.")

if __name__ == "__main__":
    manager = BotManager("config.json")
    manager.menu()
