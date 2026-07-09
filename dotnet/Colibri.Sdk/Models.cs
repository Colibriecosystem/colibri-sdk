namespace Colibri.Sdk;

// Wire models for the Colibri Local API. Prices/sizes are decimal STRINGS (crypto tick precision).

public sealed record Ping(string Name, string Version, string ApiVersion);

public sealed record BookLevel(string Price, string BaseQty, string UsdVolume);

public sealed record Book(
    string Exchange,
    string Symbol,
    string TickSize,
    string LastPrice,
    string? BestBid,
    string? BestAsk,
    IReadOnlyList<BookLevel> Bids,
    IReadOnlyList<BookLevel> Asks);

public sealed record Funding(string Exchange, string Symbol, string Rate, long NextFundingTimeMs);

public sealed record SymbolInfo(string Symbol, string Name, string BaseAsset, string QuoteAsset, string TickSize, string StepSize);

public sealed record Connection(string Id, string Exchange, string MarketType, string Label, bool Demo, bool ViewOnly, bool ApiTradingEnabled);

public sealed record Position(string Symbol, string Exchange, string Side, string Quantity, string EntryPrice);

public sealed record Order(
    string ClientOrderId,
    string? ExchangeOrderId,
    string Symbol,
    string Exchange,
    string Side,
    string Type,
    string Status,
    string Price,
    string Quantity,
    string FilledQuantity);

public sealed record Balance(string Asset, string Free, string Locked);

public sealed record OrderAccepted(string ClientOrderId, string Status);

public sealed record SignalLevel(string Id, string Exchange, string Symbol, string Price, string Direction, string? Note, bool OneShot, long CreatedMs);

/// <summary>Place an order. Give EITHER SizeQuote (spend N quote) OR SizeBase (N coins). Price for LIMIT only.</summary>
public sealed record PlaceOrderRequest
{
    public required string ConnectionId { get; init; }
    public required string Exchange { get; init; }
    public required string Symbol { get; init; }
    public required string Side { get; init; }   // BUY | SELL
    public required string Type { get; init; }   // LIMIT | MARKET
    public string? Price { get; init; }
    public string? SizeQuote { get; init; }
    public string? SizeBase { get; init; }
    public bool ReduceOnly { get; init; }
}
