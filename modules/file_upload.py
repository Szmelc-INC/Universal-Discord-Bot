import discord
from discord.ext import commands
import os

class FileUploaderCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.allowed_user_id = 818166724641030193  # Replace with your Discord user ID

    @commands.command()
    async def upload(self, ctx, channel: discord.TextChannel, *, file_path: str):
        """
        Uploads a file from the specified local path directly to the specified channel.
        Usage: !uploadfile #channel /path/to/file
        """
        if ctx.author.id != self.allowed_user_id:
            await ctx.send("You are not sernik. Wypierdalaj")
            return

        # Normalize the file path
        file_path = os.path.abspath(file_path)

        # Check if the file exists
        if not os.path.isfile(file_path):
            await ctx.send(f"The file `{file_path}` I see no shit.")
            return

        try:
            # Upload the file directly to the specified channel
            with open(file_path, 'rb') as f:
                file = discord.File(f)
                await channel.send(content="File uploaded:", file=file)

            await ctx.send(f"Plik `{file_path}` wrzucony na {channel.mention}.")
        except discord.Forbidden:
            await ctx.send("Brak mi permisji na tym kanale")
        except Exception as e:
            await ctx.send(f"Coś się zjebało: {e}")

async def setup(bot):
    await bot.add_cog(FileUploaderCog(bot))
