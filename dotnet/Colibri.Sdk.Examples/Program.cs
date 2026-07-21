// A walk-through of EVERY Colibri Local API endpoint.
//   dotnet run --project dotnet/Colibri.Sdk.Examples                 # read-only
//   dotnet run --project dotnet/Colibri.Sdk.Examples -- --arm        # also place a (resting) test order
using Colibri.Sdk;

const string exchange = "BinanceSpot";
const string symbol = "BTCUSDT";
var armed = args.Contains("--arm");

using var client = ColibriClient.Discover(); // reads %APPDATA%\Colibri\localapi.json

// ── discovery ────────────────────────────────────────────────────────────────
var ping = await client.PingAsync();
Console.WriteLine($"Connected to {ping.Name} {ping.Version} (API {ping.ApiVersion}, port {ping.Port})\n");

// ── connections ──────────────────────────────────────────────────────────────
var connections = await client.ConnectionsAsync();
Console.WriteLine($"connections ({connections.Count}):");
foreach (var c in connections)
{
    Console.WriteLine($"  {c.Id}  {(c.Label.Length > 0 ? c.Label : c.Exchange)} [{c.MarketType}]  trading={c.ApiTradingEnabled}  demo={c.Demo}");
}

// ── market data ────────────────────────────────────────────────────────────────
var venues = await client.ExchangesAsync();
Console.WriteLine($"\nvenues: {string.Join(", ", venues.Take(5).Select(v => v.Id))} …");

var symbols = await client.SymbolsAsync(exchange);
Console.WriteLine($"{exchange}: {symbols.Count} symbols");

var book = await client.BookAsync(exchange, symbol, depth: 10);
Console.WriteLine($"{symbol}  last={book.LastPrice}  bid={book.BestBid}  ask={book.BestAsk}");

var clusters = await client.ClustersAsync(exchange, symbol, limit: 30);
Console.WriteLine($"clusters: {clusters.Buckets.Count} 15-second buckets");

try
{
    var funding = await client.FundingAsync("BinanceLinearFutures", symbol);
    Console.WriteLine($"funding {funding.Symbol}: rate={funding.Rate}");
}
catch (ColibriException ex) { Console.WriteLine($"funding: {ex.Code}"); }

// ── account (first connection) ─────────────────────────────────────────────────
if (connections.Count > 0)
{
    var id = connections[0].Id;
    Console.WriteLine($"\npositions: {(await client.PositionsAsync(id)).Count}");
    Console.WriteLine($"open orders: {(await client.OrdersAsync(id)).Count}");
    Console.WriteLine($"balances: {(await client.BalanceAsync(id)).Count}");
}

// ── app bridge + signals ───────────────────────────────────────────────────────
await client.OpenSymbolAsync(exchange, symbol); // add a panel + surface the window
await client.NotifyAsync("Hello from the C# SDK", source: "example");
await client.SignalAsync(exchange, symbol, "whale wall pulled");
Console.WriteLine("\nopened symbol + posted a toast + a signal");

// ── signal levels ──────────────────────────────────────────────────────────────
if (book.BestBid is not null)
{
    var level = await client.CreateSignalLevelAsync(
        exchange, symbol, (decimal.Parse(book.BestBid) * 1.02m).ToString("F2"), direction: "above", note: "breakout watch");
    Console.WriteLine($"signal level {level.Id} @ {level.Price} (triggered={level.IsTriggered})");
    await client.DeleteSignalLevelAsync(level.Id);
    var sweep = await client.DeleteTriggeredSignalLevelsAsync();
    Console.WriteLine($"swept {sweep.Removed} fired level(s)");
}

// ── trading (grant-gated; only with --arm) ─────────────────────────────────────
var granted = connections.FirstOrDefault(c => c.ApiTradingEnabled);
if (granted is not null && armed && book.BestBid is not null)
{
    var restPrice = (decimal.Parse(book.BestBid) * 0.5m).ToString("F2"); // far from market → rests
    var placed = await client.PlaceOrderAsync(granted.Id, new PlaceOrderRequest
    {
        Symbol = symbol,
        Side = "BUY",
        Type = "Limit",
        Price = restPrice,
        SizeQuote = "10",
    });
    Console.WriteLine($"\nplaced {placed.ClientOrderId} ({placed.Status})");
    await client.CancelOrderAsync(granted.Id, placed.ClientOrderId, symbol);
    Console.WriteLine("cancelled");

    // Bulk scopes (kept commented — they act on the whole account / every granted account):
    // await client.CancelOrdersAsync(granted.Id, symbol);   // one symbol
    // await client.CancelOrdersAsync(granted.Id);           // the whole account
    // await client.ClosePositionsAsync(granted.Id);         // close every position on the account
    // await client.CancelAllOrdersAsync();                  // EVERY granted account
    // await client.CloseAllPositionsAsync();                // EVERY granted account (super-panic)
}
else if (granted is not null)
{
    Console.WriteLine("\n(pass --arm to place a resting test order on the granted connection)");
}

// ── streaming — every channel ───────────────────────────────────────────────────
await using var ws = client.Stream();
ws.On("book", f => Console.WriteLine($"[book] {f.Data.GetProperty("bestBid")} / {f.Data.GetProperty("bestAsk")}"));
ws.On("trades", f => Console.WriteLine($"[trades] {f.Data.GetProperty("trades").GetArrayLength()} prints"));
ws.On("notification", f => Console.WriteLine($"[notification] {f.Data}"));
ws.On("signalLevel", f => Console.WriteLine($"[signalLevel] {f.Event}"));
ws.On("error", f => Console.WriteLine($"[error] {f.Data}"));

await ws.ConnectAsync();
await ws.SubscribeAsync("book", new { exchange, symbol, hz = 2, depth = 20 });
await ws.SubscribeAsync("trades", new { exchange, symbol });
await ws.SubscribeAsync("notifications");
await ws.SubscribeAsync("signalLevels");
if (connections.Count > 0)
{
    await ws.SubscribeAsync("positions", new { connectionId = connections[0].Id });
    await ws.SubscribeAsync("orders", new { connectionId = connections[0].Id });
    await ws.SubscribeAsync("balance", new { connectionId = connections[0].Id });
}

Console.WriteLine("\nsubscribed to all channels — press Enter to stop");
Console.ReadLine();
