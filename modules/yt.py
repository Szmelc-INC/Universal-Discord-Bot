import discord
from discord.ext import commands
import requests

class YouTubeSearchCog(commands.Cog):
    def __init__(self, bot, api_keys):
        self.bot = bot
        self.api_keys = api_keys
        self.current_key_index = 0

    @commands.command(name='youtube', aliases=['yt'])
    async def search_youtube(self, ctx, query: str, max_results: int = 1):
        try:
            search_results = self._search_youtube(query, max_results)
            if not search_results:
                await ctx.send("No search results found.")
                return

            # Split the search results into multiple messages
            for i in range(0, len(search_results), max_results):
                results_chunk = search_results[i:i + max_results]
                await ctx.send('\n'.join(results_chunk))
        except Exception as e:
            await ctx.send(f"An error occurred: {e}")

    def _search_youtube(self, query, max_results):
        for attempt in range(len(self.api_keys)):
            try:
                api_key = self.api_keys[self.current_key_index]
                query_string = query.replace(' ', '+')
                url = (f"https://www.googleapis.com/youtube/v3/search?"
                       f"q={query_string}&part=snippet&type=video&maxResults={max_results}&key={api_key}")
                response = requests.get(url)
                if response.status_code == 403:  # Quota exceeded
                    self._switch_api_key()
                    continue
                response.raise_for_status()
                data = response.json()

                search_results = []
                for item in data.get("items", []):
                    video_id = item["id"]["videoId"]
                    video_title = item["snippet"]["title"]
                    video_url = f"https://www.youtube.com/watch?v={video_id}"
                    search_results.append(f"{video_title}: {video_url}")

                return search_results
            except requests.exceptions.RequestException as e:
                if "quota" in str(e).lower():
                    self._switch_api_key()
                else:
                    return [f"An error occurred: {e}"]

        return ["All API keys have exceeded their quota. Please try again later."]

    def _switch_api_key(self):
        self.current_key_index = (self.current_key_index + 1) % len(self.api_keys)

async def setup(bot):
    api_keys = [
        'xyz',  # Replace with YouTube-Data-V3 API Keys
        'xyz',       # Add more keys as needed
        'xyz'
    ]
    await bot.add_cog(YouTubeSearchCog(bot, api_keys))
