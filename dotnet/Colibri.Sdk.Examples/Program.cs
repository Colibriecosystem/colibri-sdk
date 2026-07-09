// Basic REST + live trades. Run: dotnet run --project dotnet/Colibri.Sdk.Examples
using Colibri.Sdk;

using var client = ColibriClient.Discover(); // reads %APPDATA%\Colibri\localapi.json

var ping = await client.PingAsync();
Console.WriteLine($"Connected to {ping.Name} {ping.Version} (API {ping.ApiVersion})");

foreach (var c in await client.ConnectionsAsync())
{
    Console.WriteLine($"- {(c.Label.Length > 0 ? c.Label : c.Exchange)} [{c.MarketType}]  trading={c.ApiTradingEnabled}  demo={c.Demo}");
}

var book = await client.BookAsync("BinanceSpot", "BTCUSDT", depth: 10);
Console.WriteLine($"\nBTCUSDT  last={book.LastPrice}  bid={book.BestBid}  ask={book.BestAsk}");

// live trades
await using var ws = client.Stream();
ws.On("trades", f =>
{
    if (f.Data.TryGetProperty("trades", out var trades))
    {
        foreach (var t in trades.EnumerateArray())
        {
            var side = t.GetProperty("isBuy").GetBoolean() ? "BUY " : "SELL";
            Console.WriteLine($"{side}  {t.GetProperty("qty").GetString()} @ {t.GetProperty("price").GetString()}");
        }
    }
});

await ws.ConnectAsync();
await ws.SubscribeAsync("trades", new { exchange = "BinanceSpot", symbol = "BTCUSDT" });

Console.WriteLine("streaming BTCUSDT trades — press Enter to stop");
Console.ReadLine();
