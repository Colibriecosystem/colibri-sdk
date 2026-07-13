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

// ── Slot control (/app/panels) ────────────────────────────────────────────────
// A SLOT is the durable box — addressed by its GUID SlotId, which survives an instrument change, a
// clear, and a terminal restart. A PANEL is the content that fills it (an orderbook, optionally
// paired with a chart). Copy ids in the terminal: the ⧉ control on a panel; right-click a tab
// header → "Copy tab ID" for the POST add-target.

/// <summary>The chart paired into a slot's column (content[1]).</summary>
public sealed record PanelChart(string Exchange, string Symbol, string Interval, string ContentId);

/// <summary>One slot. <c>SlotId</c> is the durable op key; <c>Kind</c> ∈ orderbook|chart|empty.</summary>
public sealed record PanelSlot(
    string SlotId,
    string Kind,
    bool Empty,
    string? Exchange,
    string? Symbol,
    string? ContentId,
    string? ConnectionId,
    bool ViewOnly,
    PanelChart? Chart);

/// <summary>One tab, keyed by its durable <c>Uuid</c> — the add target for POST /app/panels.</summary>
public sealed record PanelTab(string Uuid, int Index, IReadOnlyList<PanelSlot> Slots);

/// <summary>One window, keyed by position (durable window ids are a later addition).</summary>
public sealed record PanelWindow(int Index, IReadOnlyList<PanelTab> Tabs);

/// <summary>
///     The desired content of a slot: ONE instrument + the views that render it. <c>Views</c> ∈
///     <c>["orderbook"]</c> | <c>["chart"]</c> (a standalone chart slot) | <c>["orderbook","chart"]</c>
///     (the pair, same instrument, app-default timeframe). <c>ConnectionId</c> binds a trading account
///     (grant-gated; requires the orderbook view); null = the app adopts the venue's default connection.
/// </summary>
public sealed record PanelContent(string Exchange, string Symbol, IReadOnlyList<string> Views, string? ConnectionId = null);

/// <summary>One venue from <c>GET /exchanges</c> — <c>Id</c> is the string every exchange param accepts.</summary>
public sealed record ExchangeInfo(string Id, string Name, string MarketType, bool Trading);

/// <summary>Result of an add / set / remove — the status plus the affected slot.</summary>
public sealed record PanelActionResult(string Status, PanelSlot? Panel);

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
