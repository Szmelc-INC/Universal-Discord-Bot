import discord
from discord.ext import commands
import re
import os
import random
import asyncio

class RuchanieLogger(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.log_file = "ruchanie.log"
        self.ruchanie_pattern = re.compile(r"ruchanie", re.IGNORECASE)

    def update_log(self, user_id, username, is_reply):
        log_data = {}
        if os.path.exists(self.log_file):
            with open(self.log_file, "r", encoding="utf-8") as file:
                for line in file:
                    parts = line.strip().split()
                    if len(parts) == 4:
                        log_data[parts[0]] = {
                            "username": parts[1],
                            "Ruchanie": int(parts[2].split(':')[1]),
                            "Zruchanie": int(parts[3].split(':')[1])
                        }
        
        if user_id not in log_data:
            log_data[user_id] = {"username": username, "Ruchanie": 0, "Zruchanie": 0}
        
        log_data[user_id]["Ruchanie"] += 1
        if is_reply:
            log_data[user_id]["Zruchanie"] += 1
        
        with open(self.log_file, "w", encoding="utf-8") as file:
            for uid, data in log_data.items():
                file.write(f"{uid} {data['username']} Ruchanie:{data['Ruchanie']} Zruchanie:{data['Zruchanie']}\n")

    @commands.command(name='ruchanking')
    async def ruchanking(self, ctx):
        if os.path.exists(self.log_file):
            with open(self.log_file, 'r', encoding='utf-8') as file:
                log_data = file.read() or 'No data found.'
                await ctx.send(f"```{log_data}```")
        else:
            await ctx.send('No data found.')

    async def random_ruchanie(self):
        await self.bot.wait_until_ready()
        while not self.bot.is_closed():
            await asyncio.sleep(random.randint(1800, 3600))  # Wait 30 to 60 minutes
            guilds = self.bot.guilds
            if not guilds:
                continue

            random_guild = random.choice(guilds)
            text_channels = [channel for channel in random_guild.text_channels if channel.permissions_for(random_guild.me).send_messages]
            if not text_channels:
                continue

            random_channel = random.choice(text_channels)
            await random_channel.send('# Ruchanie')

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot:
            return

        if self.ruchanie_pattern.search(message.content):
            await message.add_reaction("\U0001F525")  # 🔥 emoji
            self.update_log(str(message.author.id), message.author.name, message.reference is not None)

    @commands.Cog.listener()
    async def on_ready(self):
        print("RuchanieLogger is ready.")

async def setup(bot):
    ruchanie_logger = RuchanieLogger(bot)
    await bot.add_cog(ruchanie_logger)
    bot.loop.create_task(ruchanie_logger.random_ruchanie())
