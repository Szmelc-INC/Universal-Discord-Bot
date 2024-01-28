import discord
from discord.ext import commands
import requests

class CryptoPriceCog(commands.Cog):
    def __init__(self, bot, api_key):
        self.bot = bot
        self.api_key = api_key

    @commands.command(name='crypto')
    async def crypto_price(self, ctx, symbol='TOP10'):
        """Displays crypto prices. Use a symbol for specific crypto or 'TOP10' for the top 10."""
        if symbol.upper() == 'TOP10':
            message = await self.get_top_10_cryptos()
        else:
            message = await self.get_crypto_price(symbol.upper())

        await ctx.send(message)

    async def get_crypto_price(self, symbol):
        url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest"
        headers = {'Accepts': 'application/json', 'X-CMC_PRO_API_KEY': self.api_key}
        params = {'symbol': symbol, 'convert': 'PLN'}
        response = requests.get(url, headers=headers, params=params)
        data = response.json()

        if data['status']['error_code'] == 0:
            price = data['data'][symbol]['quote']['PLN']['price']
            return f"The current price of {symbol} is {price:.2f} PLN."
        else:
            return f"Error: Could not fetch the price for {symbol}."

    async def get_top_10_cryptos(self):
        url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest"
        headers = {'Accepts': 'application/json', 'X-CMC_PRO_API_KEY': self.api_key}
        params = {'limit': 10, 'convert': 'PLN'}
        response = requests.get(url, headers=headers, params=params)
        data = response.json()

        if data['status']['error_code'] == 0:
            cryptos = data['data']
            message = "Top 10 Cryptocurrencies:\n"
            for crypto in cryptos:
                name = crypto['name']
                symbol = crypto['symbol']
                price = crypto['quote']['PLN']['price']
                message += f"{name} ({symbol}): {price:.2f} PLN\n"
            return message
        else:
            return "Error: Could not fetch top 10 cryptocurrencies."

async def setup(bot):
    api_key = '8af4164f-ccf2-4463-86f7-aeaf2d6f7f1d'  # Replace with your CoinMarketCap API key
    await bot.add_cog(CryptoPriceCog(bot, api_key))

