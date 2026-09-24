using System.Text.Json.Serialization;

namespace Colibri.Sdk;

// Wire models for the Colibri Local API. Prices/sizes are decimal STRINGS (crypto tick precision).

/// <summary><c>GET /ping</c> — liveness, versions, and the live bound port.</summary>
/// <summary>
///     <c>GET /ping</c>. <c>ApiVersion</c> is what an UNVERSIONED request gets;
///     <c>SupportedApiVersions</c> every response-shape version the <c>api-version</c> header may
///     select (null on a terminal that predates versioning — read it as <c>[1]</c>). This SDK sends
///     <see cref="ColibriClient.ApiVersion" />.
/// </summary>
public sealed record Ping(string Name, string Version, int ApiVersion, int Port, IReadOnlyList<int>? SupportedApiVersions = null);

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

/// <summary>Per-price buy/sell sums inside one 15-second base bucket, in both units.</summary>
public sealed record ClusterLevel(string Price, string BuyUsd, string SellUsd, string BuyBase, string SellBase);

/// <summary>One 15-second base footprint bucket (<c>StartUnixSec</c> is unix SECONDS). Merge timeframes client-side.</summary>
public sealed record Cluster(
    long StartUnixSec,
    string TotalBuyUsd,
    string TotalSellUsd,
    string TotalBuyBase,
    string TotalSellBase,
    IReadOnlyList<ClusterLevel> Levels);

/// <summary><c>GET /markets/{exchange}/{symbol}/clusters</c> — raw 15-second base buckets, oldest → newest.</summary>
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
///     (<c>Above</c>/<c>Below</c>/<c>Cross</c>). A level is a pure market alert —
///     venue + symbol only, never tied to a connection.
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

// ── Slot control (/app/panels, api-version 2) ────────────────────────────────
// A SLOT is the durable box — addressed by its GUID Id, which survives an instrument change, a
// clear, a kind transition, and a terminal restart. A tab is ONE layout tree: a node is a SplitNode
// (children side by side = "row", stacked = "column") or a SlotNode, and a leaf IS the slot. What
// fills a slot is a union on `kind` carrying only the fields that mean something for that kind.
// Copy ids in the terminal: the ⧉ control on a panel; right-click a tab header → "Copy tab ID".
//
// Polymorphism: the terminal writes the discriminator FIRST, which is what lets System.Text.Json
// resolve these on net8 without AllowOutOfOrderMetadataProperties. Properties holding a leaf are
// typed as the BASE (LayoutNode) — the discriminator is only honoured through it.

/// <summary>A layout node — <see cref="SplitNode" /> or <see cref="SlotNode" />; <c>Share</c> is its fraction of its parent, null on the root.</summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(SplitNode), "split")]
[JsonDerivedType(typeof(SlotNode), "slot")]
public abstract record LayoutNode
{
    public double? Share { get; init; }
}

/// <summary>A split: <c>Orientation</c> ∈ <c>row</c> (children side by side) | <c>column</c> (stacked).</summary>
public sealed record SplitNode(string Orientation, IReadOnlyList<LayoutNode> Children) : LayoutNode;

/// <summary>
///     A slot — the durable box (<c>Id</c> is the op key for set / clear / remove) with what fills it.
///     <c>Surface</c> is <c>"slot"</c> on the workspace surface and null on the deprecated
///     <c>/app/panels</c> reads, which do not send it.
/// </summary>
public sealed record SlotNode(string Id, SlotContent Content) : LayoutNode
{
    public string? Surface { get; init; }
}

/// <summary>What a slot holds — a union on <c>kind</c>. <c>ContentId</c> is UNIFORM across the filled kinds.</summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(EmptyContent), "empty")]
[JsonDerivedType(typeof(OrderbookContent), "orderbook")]
[JsonDerivedType(typeof(ChartContent), "chart")]
[JsonDerivedType(typeof(WidgetContent), "widget")]
public abstract record SlotContent;

/// <summary>The "+" placeholder — a box you may fill.</summary>
public sealed record EmptyContent : SlotContent;

/// <summary>An orderbook. <c>ConnectionId</c> is present only when a trading account is bound; <c>ViewOnly</c> = no trading through this box.</summary>
public sealed record OrderbookContent(string Exchange, string Symbol, string ContentId, bool ViewOnly, string? ConnectionId = null) : SlotContent;

/// <summary>A candlestick chart; <c>Interval</c> is the timeframe (e.g. <c>M5</c>).</summary>
public sealed record ChartContent(string Exchange, string Symbol, string Interval, string ContentId) : SlotContent;

/// <summary>A widget box — visible here, never placed/changed/cleared through the API. <c>ContentId</c> is the widget's instance id.</summary>
public sealed record WidgetContent(string WidgetId, string ContentId, string Name, bool Installed) : SlotContent;

/// <summary>One tab, keyed by its durable <c>Id</c> (the add target). <c>Layout</c> is its whole tree; a single-box tab has a <see cref="SlotNode" /> root.</summary>
public sealed record PanelTab(string Id, int Index, bool Active, string Title, LayoutNode? Layout);

/// <summary>One window, keyed by position (0 = the main window; durable ids are a later addition).</summary>
public sealed record PanelWindow(int Index, bool Active, IReadOnlyList<PanelTab> Tabs);

/// <summary>The parent split of a slot: its axis, the slot's index among the siblings, how many there are.</summary>
public sealed record SlotParent(string Orientation, int Index, int Count);

/// <summary>Where one slot sits; <c>Parent</c> is null for a root slot (a single-box tab).</summary>
public sealed record SlotPosition(int Window, string Tab, IReadOnlyList<int> Path, int Depth, SlotParent? Parent = null);

/// <summary><c>GET /app/panels/{id}</c> — the slot (a <see cref="SlotNode" />, byte-identical to its tree leaf) plus where it sits.</summary>
public sealed record SlotLookup(LayoutNode Slot, SlotPosition Position);

/// <summary>
///     One content to PLACE — the read side's union minus the ids the terminal mints. <c>Kind</c> ∈
///     <c>orderbook</c> | <c>chart</c> (a widget is never placed); <c>Interval</c> for a chart;
///     <c>ConnectionId</c> binds a trading account (grant-gated, orderbook only; null = the app adopts
///     the venue's default connection); <c>Share</c> (0–1, exclusive) sizes the box within a stack.
///     <c>Views</c> is the legacy one-instrument-plus-views form (still accepted) — leave it null
///     when <c>Kind</c> is set.
/// </summary>
public sealed record PanelContent(
    string Exchange,
    string Symbol,
    IReadOnlyList<string>? Views = null,
    string? ConnectionId = null,
    string? Kind = null,
    string? Interval = null,
    double? Share = null)
{
    /// <summary>A placeable orderbook.</summary>
    public static PanelContent Orderbook(string exchange, string symbol, string? connectionId = null, double? share = null) =>
        new(exchange, symbol, null, connectionId, "orderbook", null, share);

    /// <summary>A placeable chart; <paramref name="interval" /> null = the app default.</summary>
    public static PanelContent Chart(string exchange, string symbol, string? interval = null, double? share = null) =>
        new(exchange, symbol, null, null, "chart", interval, share);
}

/// <summary>Where a stack lands: beside <c>SlotId</c> on <c>Side</c> (<c>left|right|top|bottom</c>) using <c>Action</c> (<c>pair|row|column|intoRow</c>; null = pair).</summary>
public sealed record PanelTarget(string SlotId, string? Side = null, string? Action = null);

// ── workspace (supersedes panels; carries no api-version — every route in it is new) ────────────
// The terminal's WINDOWS, the TABS inside a window, the durable BOXES docked in a tab's layout
// tree, and the CHART WINDOWS floating beside them. A tab's Layout is the very tree the panel
// surface serves, so LayoutNode / SplitNode / SlotNode / SlotContent are reused verbatim.
//
// The write types below have PRIVATE constructors and static factories on purpose. A content
// object must put `kind` FIRST on the wire — the terminal resolves the write union by a
// discriminator it expects to read before anything else, and a content that leads with another key
// fails the parse rather than answering a 400. [JsonPropertyOrder(-1)] plus a factory is what makes
// that unrepresentable, rather than a rule someone has to remember.

/// <summary>
///     A window rectangle. When <c>Maximized</c> is true this is the last NON-maximized position —
///     where the window un-maximizes to, not where it sits on screen. The two are meaningless apart.
/// </summary>
public sealed record Bounds(int Left, int Top, int Width, int Height, bool Maximized);

/// <summary>
///     A floating chart window a tab owns. <c>Kind</c> ∈ <c>chart</c> (one timeframe — has
///     <see cref="Interval" /> and <see cref="ContentId" />) | <c>comboChart</c> (three panes — has
///     <see cref="Intervals" /> and <see cref="Sync" />, and NO content identity, because three panes
///     have no single one). The four kind-specific members are null on the other kind.
///     <para>
///         Flat rather than a polymorphic hierarchy: the two variants share nine of twelve fields, so
///         a base type would buy matching on two of them at the cost of a cast on every ordinary read.
///     </para>
/// </summary>
public sealed record ChartWindow(
    string Surface,
    string Kind,
    string Id,
    string Exchange,
    string Symbol,
    Bounds Bounds,
    bool Pinned,
    bool Locked,
    string? TabId = null,
    string? Interval = null,
    string? ContentId = null,
    IReadOnlyList<string>? Intervals = null,
    bool? Sync = null)
{
    /// <summary>True for the 3-pane / 3-timeframe combo window.</summary>
    [JsonIgnore]
    public bool IsCombo => Kind == "comboChart";
}

/// <summary>
///     One tab of the workspace. <c>Title</c> is the label the header actually RENDERS — the user's
///     name when the tab has one, else the sticky first coin plus a panel count (<c>"BTC (3)"</c>).
///     <c>Layout</c> is null on a tab that has never been laid out; <c>Windows</c> is always present,
///     empty when the tab owns no floating chart window.
/// </summary>
public sealed record WorkspaceTab(
    string Id,
    int Index,
    bool Active,
    string Title,
    IReadOnlyList<ChartWindow> Windows,
    LayoutNode? Layout = null);

/// <summary>One window with its whole tab payload. <c>Kind</c> ∈ <c>main</c> | <c>book</c>; <c>Index</c> 0 is the main window.</summary>
public sealed record WorkspaceWindow(
    string Id,
    int Index,
    string Kind,
    bool Active,
    Bounds Bounds,
    bool Locked,
    IReadOnlyList<WorkspaceTab> Tabs);

/// <summary>One window WITHOUT its tab payload — <c>TabCount</c> instead of the tabs themselves.</summary>
public sealed record WindowSummary(
    string Id,
    int Index,
    string Kind,
    bool Active,
    Bounds Bounds,
    bool Locked,
    int TabCount);

/// <summary>Which window a tab sits in, and where.</summary>
public sealed record TabPosition(string WindowId, int WindowIndex, int TabCount);

/// <summary><c>GET /app/tabs/{tabId}</c> — the tab, byte-identical to its node in the workspace, plus where it sits.</summary>
public sealed record TabLookup(WorkspaceTab Tab, TabPosition Position);

/// <summary>The answer to a tab create / update. <c>Status</c> ∈ <c>created</c> | <c>changed</c>.</summary>
public sealed record TabAction(string Status, WorkspaceTab Tab, TabPosition Position);

/// <summary>The answer to a tab close.</summary>
public sealed record TabRemoved(string Status, string TabId);

/// <summary>The answer to a window activate.</summary>
public sealed record WindowAction(string Status, WindowSummary Window);

/// <summary>
///     Where one box sits on the workspace surface. NOT <see cref="SlotPosition" />: that one keys its
///     window by INDEX and spells the tab <c>Tab</c>; this one carries durable string ids for both.
///     <c>Parent</c> is null exactly when the slot is a root — a single-box tab.
/// </summary>
public sealed record WorkspaceSlotPosition(
    string WindowId,
    string TabId,
    IReadOnlyList<int> Path,
    int Depth,
    SlotParent? Parent = null);

/// <summary><c>GET /app/slots/{slotId}</c> — the box (a <see cref="SlotNode" />) and where it sits.</summary>
public sealed record WorkspaceSlotLookup(LayoutNode Slot, WorkspaceSlotPosition Position);

/// <summary>The answer to an add — every box it made, in request order, each in the tree's own leaf shape.</summary>
public sealed record SlotsAdded(string Status, IReadOnlyList<LayoutNode> Slots);

/// <summary>The answer to a set — THIS box only.</summary>
public sealed record SlotChanged(string Status, LayoutNode Slot);

/// <summary>The answer to a remove — the box is gone and its id retired.</summary>
public sealed record SlotRemoved(string Status, string SlotId);

/// <summary>The answer to a chart-window open / update. <c>Status</c> ∈ <c>opened</c> | <c>changed</c>.</summary>
public sealed record ChartWindowAction(string Status, ChartWindow ChartWindow);

/// <summary>The answer to a chart-window close.</summary>
public sealed record ChartWindowRemoved(string Status, string ChartWindowId);

/// <summary>
///     What a box may hold. <c>Kind</c> ∈ <c>orderbook</c> | <c>chart</c> | <c>empty</c> — build one
///     with a factory. <see cref="Empty" /> clears a box on a set, and is REFUSED inside an add,
///     because an add inserts CONTENT.
///     <para>
///         Note there is no <c>Share</c> here: on this surface the share belongs to the
///         <see cref="NewSlot" />, and one written inside a content is silently dropped.
///     </para>
/// </summary>
public sealed record SettableContent
{
    private SettableContent() { }

    /// <summary>
    ///     FIRST on the wire on purpose — the terminal resolves this union by a discriminator it
    ///     expects to read before anything else.
    /// </summary>
    [JsonPropertyOrder(-1)]
    public string Kind { get; private init; } = "empty";

    public string? Exchange { get; private init; }
    public string? Symbol { get; private init; }
    public string? Interval { get; private init; }
    public string? ConnectionId { get; private init; }

    /// <summary>Clear the box — it stays on screen and keeps its id.</summary>
    public static SettableContent Empty { get; } = new();

    /// <summary>An orderbook; <paramref name="connectionId" /> binds a trading account (GRANT-gated, null = the app picks).</summary>
    public static SettableContent Orderbook(string exchange, string symbol, string? connectionId = null) =>
        new() { Kind = "orderbook", Exchange = exchange, Symbol = symbol, ConnectionId = connectionId };

    /// <summary>A chart; <paramref name="interval" /> null = the app default.</summary>
    public static SettableContent Chart(string exchange, string symbol, string? interval = null) =>
        new() { Kind = "chart", Exchange = exchange, Symbol = symbol, Interval = interval };
}

/// <summary>
///     One box to create — a slot node minus the ids the server mints. <c>Share</c> (0–1, exclusive)
///     is converted PER INSERTION: a list nests as it is inserted, so the i-th box asks for a fraction
///     of what is LEFT. Omitted = an even split; values clamp into 0.05–0.95.
/// </summary>
public sealed record NewSlot
{
    private NewSlot() { }

    public double? Share { get; private init; }
    public SettableContent Content { get; private init; } = SettableContent.Empty;

    /// <summary>An orderbook box.</summary>
    public static NewSlot Orderbook(string exchange, string symbol, string? connectionId = null, double? share = null) =>
        new() { Share = share, Content = SettableContent.Orderbook(exchange, symbol, connectionId) };

    /// <summary>A chart box.</summary>
    public static NewSlot Chart(string exchange, string symbol, string? interval = null, double? share = null) =>
        new() { Share = share, Content = SettableContent.Chart(exchange, symbol, interval) };
}

/// <summary>
///     Where new boxes go: beside an anchor box (<see cref="Beside" />) or at the tab's edge
///     (<see cref="AtEdge" />) — never both, and a side never travels without its anchor. The
///     constructor is private so the illegal combination cannot be built at all.
///     <para>
///         There is deliberately no "mode": how the room is found next to an anchor is decided by the
///         side and the two content kinds, not by the caller.
///     </para>
/// </summary>
public sealed record SlotTarget
{
    private SlotTarget() { }

    /// <summary>The ANCHOR box. It survives, smaller — it is never replaced.</summary>
    public string? Slot { get; private init; }

    /// <summary><c>left|right|top|bottom</c>; required with <see cref="Slot" />, never defaulted — it decides the structural outcome.</summary>
    public string? Side { get; private init; }

    /// <summary><c>left</c>/<c>right</c>: a full-height column. <c>top</c>/<c>bottom</c>: a full-width row.</summary>
    public string? Edge { get; private init; }

    /// <summary>Beside <paramref name="slotId" /> on <paramref name="side" />.</summary>
    public static SlotTarget Beside(string slotId, string side) => new() { Slot = slotId, Side = side };

    /// <summary>At the tab's edge.</summary>
    public static SlotTarget AtEdge(string edge) => new() { Edge = edge };
}

// ── closed trades ───────────────────────────────────────────────────────────────────────────────

/// <summary>
///     One CLOSED position — a history row, not a live tape print. <c>Side</c> ∈ <c>Long</c> |
///     <c>Short</c>; every money and size field is a decimal STRING. A row is AMENDABLE after it is
///     written, so a poller should re-read rather than cache. <c>VolumeUsd</c> is the round-trip
///     turnover in quote, entry leg plus exit leg; <c>PnlPercent</c> is recomputed over the entry
///     notional (<c>Quantity</c> × <c>OpenPrice</c>), not over <c>VolumeUsd</c>.
/// </summary>
public sealed record ClosedTrade(
    long Id,
    string Exchange,
    string Symbol,
    string Side,
    string OpenPrice,
    string ClosePrice,
    string Quantity,
    string VolumeUsd,
    string NetPnl,
    string PnlPercent,
    string Commission,
    string Funding,
    long OpenTimeMs,
    long CloseTimeMs);

/// <summary><c>GET /connections/{id}/trades</c> — one page of history, newest CLOSE first.</summary>
public sealed record ClosedTradesPage(
    string ConnectionId,
    IReadOnlyList<ClosedTrade> Trades,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages);

/// <summary>One venue fill that makes up a closed trade.</summary>
public sealed record ClosedTradeFill(
    string Price,
    string Quantity,
    string QuoteQuantity,
    string Commission,
    bool IsBuyer,
    long TimeMs,
    string VenueTradeId);

/// <summary><c>GET /connections/{id}/trades/{tradeId}</c> — one closed trade with its fills, oldest first.</summary>
public sealed record ClosedTradeDetail(
    string ConnectionId,
    ClosedTrade Trade,
    IReadOnlyList<ClosedTradeFill> Fills);

/// <summary>One venue from <c>GET /exchanges</c> — <c>Id</c> is the string every exchange param accepts.</summary>
public sealed record ExchangeInfo(string Id, string Name, string MarketType, bool Trading);

/// <summary>
///     Result of an add / set / clear / remove — the affected box(es) in the tree's own leaf shape.
///     <c>Slot</c> is the primary (first) box (a <see cref="SlotNode" />), <c>Slots</c> every box a
///     stack add created, in request order.
/// </summary>
public sealed record SlotAction(string Status, LayoutNode? Slot = null, IReadOnlyList<LayoutNode>? Slots = null);

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
