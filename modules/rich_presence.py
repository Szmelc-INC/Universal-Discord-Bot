from pypresence import AioPresence
import time
import asyncio
from discord.ext import commands

class RichPresenceCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.client_id = "<APP ID>"  # Replace with your application's client ID
        self.rpc_client = None
        self.presence_data = {
            "state": "Prototyping",
            "details": "PsyOPS 7",
            "start": int(time.time()),  # Correct field name for start timestamp
            "end": int(time.time()) + 3600,  # Correct field name for end timestamp
            "large_image": "numbani",
            "large_text": "$x77",
            "small_image": "rogue",
            "small_text": "Szmelc Incorporated",
            "party_id": "ae488379-351d-4a4f-ad32-2b9b01c91657",
            "party_size": [21, 37],
            "join": "MTI4NzM0OjFpMmhuZToxMjMxMjM=",  # Correct field name for join secret
        }
        self.rpc_task = None

    async def start_rich_presence(self):
        """Start the rich presence client."""
        if self.rpc_client is not None:
            print("Rich presence is already running.")
            return

        try:
            self.rpc_client = AioPresence(self.client_id, loop=asyncio.get_running_loop())
            await self.rpc_client.connect()
            self.rpc_task = asyncio.create_task(self.update_presence())
            print("Rich presence started.")
        except Exception as e:
            print(f"Failed to start rich presence: {e}")
            self.rpc_client = None

    async def stop_rich_presence(self):
        """Stop the rich presence client."""
        if self.rpc_task:
            self.rpc_task.cancel()
            self.rpc_task = None

        if self.rpc_client:
            await self.rpc_client.close()
            self.rpc_client = None
            print("Rich presence stopped.")

    async def update_presence(self):
        """Periodically update the rich presence."""
        while True:
            try:
                await self.rpc_client.update(**self.presence_data)
                print("Rich presence updated.")
            except Exception as e:
                print(f"Failed to update presence: {e}")
            await asyncio.sleep(15)  # Update interval

    @commands.command()
    async def startpresence(self, ctx):
        """Command to start rich presence."""
        if ctx.author.id != 818166724641030193:  # Replace with your Discord user ID
            await ctx.send("You are not authorized to use this command.")
            return

        await self.start_rich_presence()
        await ctx.send("Rich presence started.")

    @commands.command()
    async def stoppresence(self, ctx):
        """Command to stop rich presence."""
        if ctx.author.id != 818166724641030193:  # Replace with your Discord user ID
            await ctx.send("You are not authorized to use this command.")
            return

        await self.stop_rich_presence()
        await ctx.send("Rich presence stopped.")

    @commands.command()
    async def updatepresence(self, ctx, field: str, *, value: str):
        """Command to update a field in the presence data."""
        if ctx.author.id != 818166724641030193:  # Replace with your Discord user ID
            await ctx.send("You are not authorized to use this command.")
            return

        if field in self.presence_data:
            # Convert value to int for timestamps
            if field in ["start", "end", "party_size"]:
                value = int(value)
            elif field == "party_size":
                value = list(map(int, value.split(",")))
            self.presence_data[field] = value
            await ctx.send(f"Updated `{field}` to `{value}`.")
        else:
            await ctx.send(f"Field `{field}` not found in presence data.")

    @commands.command()
    async def showpresence(self, ctx):
        """Command to display the current presence data."""
        if ctx.author.id != 818166724641030193:  # Replace with your Discord user ID
            await ctx.send("You are not authorized to use this command.")
            return

        await ctx.send(f"Current presence data: {self.presence_data}")

    def cog_unload(self):
        """Clean up when the cog is unloaded."""
        asyncio.create_task(self.stop_rich_presence())

async def setup(bot):
    cog = RichPresenceCog(bot)
    await bot.add_cog(cog)
