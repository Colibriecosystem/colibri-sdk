namespace Colibri.Sdk;

// Wire models for the Colibri Local API. Prices/sizes are decimal STRINGS (crypto tick precision).

/// <summary><c>GET /ping</c> — liveness, versions, and the live bound port.</summary>
public sealed record Ping(string Name, string Version, int ApiVersion, int Port);

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

/// <summary>Per-price buy/sell sums inside one 1-minute bucket, in both units.</summary>
public sealed record ClusterLevel(string Price, string BuyUsd, string SellUsd, string BuyBase, string SellBase);

/// <summary>One 1-minute footprint bucket (<c>StartUnixSec</c> is unix SECONDS). Merge timeframes client-side.</summary>
public sealed record Cluster(
    long StartUnixSec,
    string TotalBuyUsd,
    string TotalSellUsd,
    string TotalBuyBase,
    string TotalSellBase,
    IReadOnlyList<ClusterLevel> Levels);

/// <summary><c>GET /markets/{exchange}/{symbol}/clusters</c> — raw 1-minute buckets, oldest → newest.</summary>
public sealed record Clusters(string Exchange, string Symbol, string TickSize, IReadOnlyList<Cluster> Buckets);

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

/// <summary>All-granted sweep result (<c>DELETE /orders</c> / <c>DELETE /positions</c>).</summary>
public sealed record SweepResult(string Status, int Accounts);

/// <summary>
///     One API-owned price alert. A level fires AT MOST ONCE: <c>OneShot</c> removes it on fire,
///     else it is kept marked <c>IsTriggered</c> + <c>TriggeredMs</c> (sweep them via
///     <c>DELETE /signal-levels/triggered</c>). <c>Direction</c> is the enum NAME
///     (<c>Above</c>/<c>Below</c>/<c>Cross</c>); <c>ConnectionId</c> is the optional owning
///     connection (organizational — the fire path is account-agnostic).
/// </summary>
public sealed record SignalLevel(
    string Id,
    string Exchange,
    string Symbol,
    string Price,
    string Direction,
    string? Note,
    bool OneShot,
    long CreatedMs,
    string? ConnectionId,
    bool IsTriggered,
    long? TriggeredMs);

/// <summary>How many levels a DELETE removed (0 = nothing matched).</summary>
public sealed record SignalLevelRemoved(int Removed);

/// <summary>
///     The curated orderbook-settings slice (exchange tier of the terminal's settings cascade).
///     GET returns every field set (effective values); PATCH takes any subset — only non-null
///     fields change. Decimals are strings; enums are their names.
/// </summary>
public sealed record OrderbookSettings(
    string? SizeUnit = null,
    string? DepthUnit = null,
    int? MinTradeUsd = null,
    string? MinTradeBase = null,
    int? TickWindowMs = null,
    int? VolumeBarThresholdUsd = null,
    int? LargeVolumeUsd = null,
    int? LargeVolume2Usd = null,
    int? ClusterFillThresholdUsd = null,
    string? AggregationMode = null,
    string? AggregationDefaultValue = null,
    bool? ShowTicks = null,
    bool? ShowLiquidations = null,
    string? StopLossPercent = null,
    bool? OcoEnabled = null,
    string? OcoTakeProfitPercent = null,
    string? OcoStopLossPercent = null);

/// <summary><c>GET/PATCH /exchanges/{exchange}/orderbook-settings</c> envelope.</summary>
public sealed record OrderbookSettingsResponse(string Exchange, OrderbookSettings Settings);

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

/// <summary>
///     Place an order (<c>POST /connections/{id}/orders</c>). The connection — and therefore the
///     venue — is the URL, so the body carries neither. Give EITHER SizeQuote (spend N quote) OR
///     SizeBase (N coins). Price for Limit only (Market must not carry one).
/// </summary>
public sealed record PlaceOrderRequest
{
    public required string Symbol { get; init; }
    public required string Side { get; init; }   // BUY | SELL
    public required string Type { get; init; }   // Limit | Market
    public string? Price { get; init; }
    public string? SizeQuote { get; init; }
    public string? SizeBase { get; init; }
    public bool ReduceOnly { get; init; }
}
