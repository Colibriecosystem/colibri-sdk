using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Colibri.Sdk;

/// <summary>An API error carrying the parsed <c>{code, message}</c> (or the HTTP status).</summary>
public sealed class ColibriException(int status, string code, string message) : Exception($"[{status} {code}] {message}")
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

/// <summary>
///     REST client for the Colibri Local API. Reads need no credential at all; <b>trading</b> needs the
///     bearer token AND a per-connection grant (Settings → Program → Local API). Every number on the
///     wire is a decimal string.
/// </summary>
/// <example>
///     <code>
///     using var readOnly = new ColibriClient(18845);              // screener / dashboard
///     using var trader   = new ColibriClient(18845, "token…");    // can also place / cancel
///     </code>
/// </example>
public sealed class ColibriClient : IDisposable
{
    // Web defaults (camelCase, case-insensitive reads) plus: a null PROPERTY is simply not written.
    // The workspace PATCH bodies are read KEY-wise by the terminal — a stray "title": null clears a
    // user's tab name and still answers 200 — so a null here has to mean "absent", the way it does
    // in every one of this client's optional arguments. Dictionary VALUES are exempt from the
    // condition, which is how UpdateTabAsync still sends a DELIBERATE null.
    private static readonly JsonSerializerOptions Json =
        new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    private readonly HttpClient _http;

    /// <summary>
    ///     The response-shape version this SDK is written against, sent as the <c>api-version</c>
    ///     header on every call. Today only the <c>/app/panels</c> family has two shapes; every other
    ///     route ignores it. A terminal that predates v2 ignores the header and answers v1 — so this
    ///     SDK needs a terminal that serves v2 (check <see cref="Ping.SupportedApiVersions" />).
    ///     From terminal 1.4.0 v1 is removed and the header is ignored.
    /// </summary>
    public const int ApiVersion = 2;

    /// <param name="token">
    ///     Only needed to place or cancel orders. Omit it for a read-only client and no
    ///     <c>Authorization</c> header is sent at all (a bare "Bearer " would be malformed).
    /// </param>
    public ColibriClient(int port, string? token = null, string host = "127.0.0.1")
    {
        _http = new HttpClient { BaseAddress = new Uri($"http://{host}:{port}") };
        _http.DefaultRequestHeaders.Add("api-version", ApiVersion.ToString(System.Globalization.CultureInfo.InvariantCulture));
        if (!string.IsNullOrEmpty(token))
        {
            _http.DefaultRequestHeaders.Authorization = new("Bearer", token);
        }

        Base = _http.BaseAddress;
        Token = token;
    }

    public Uri Base { get; }

    /// <summary>The token this client was built with, or <c>null</c> for a read-only client.</summary>
    public string? Token { get; }

    /// <summary>Auto-connect via the discovery file the terminal writes while the API is on.</summary>
    public static ColibriClient Discover(string host = "127.0.0.1")
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var path = Path.Combine(appData, "Colibri", "localapi.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;
        return new ColibriClient(root.GetProperty("port").GetInt32(), root.GetProperty("token").GetString()!, host);
    }

    private async Task<T> GetAsync<T>(string path, CancellationToken ct)
    {
        using var res = await _http.GetAsync(path, ct).ConfigureAwait(false);
        return await ReadAsync<T>(res, ct).ConfigureAwait(false);
    }

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            req.Content = JsonContent.Create(body, options: Json);
        }

        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        return await ReadAsync<T>(res, ct).ConfigureAwait(false);
    }

    private static async Task<T> ReadAsync<T>(HttpResponseMessage res, CancellationToken ct)
    {
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            // Error bodies are a top-level {code, message}.
            var code = $"http_{(int)res.StatusCode}";
            var message = text;
            try
            {
                using var doc = JsonDocument.Parse(text);
                var root = doc.RootElement;
                code = root.TryGetProperty("code", out var c) ? c.GetString() ?? code : code;
                message = root.TryGetProperty("message", out var m) ? m.GetString() ?? message : message;
            }
            catch (JsonException) { /* non-JSON body — keep the raw text */ }

            throw new ColibriException((int)res.StatusCode, code, message);
        }

        return string.IsNullOrEmpty(text) ? default! : JsonSerializer.Deserialize<T>(text, Json)!;
    }

    private static string E(string value) => Uri.EscapeDataString(value);

    // ── discovery / connections ──────────────────────────────────────────────
    /// <summary>Liveness + version + the live bound port.</summary>
    public Task<Ping> PingAsync(CancellationToken ct = default) => GetAsync<Ping>("/ping", ct);

    public async Task<IReadOnlyList<Connection>> ConnectionsAsync(CancellationToken ct = default) =>
        (await GetAsync<ConnectionsResponse>("/connections", ct).ConfigureAwait(false)).Connections;

    public Task<Connection> ConnectionAsync(string id, CancellationToken ct = default) =>
        GetAsync<Connection>($"/connections/{E(id)}", ct);

    // ── market data ──────────────────────────────────────────────────────────
    /// <summary>The venue catalog — <c>Id</c> is the string every exchange param accepts; <c>Trading:false</c> = view-only venue.</summary>
    public async Task<IReadOnlyList<ExchangeInfo>> ExchangesAsync(CancellationToken ct = default) =>
        (await GetAsync<ExchangesResponse>("/exchanges", ct).ConfigureAwait(false)).Exchanges;

    /// <summary>GET /exchanges/{exchange}/symbols — the venue's symbol universe.</summary>
    public async Task<IReadOnlyList<SymbolInfo>> SymbolsAsync(string exchange, CancellationToken ct = default) =>
        (await GetAsync<SymbolsResponse>($"/exchanges/{E(exchange)}/symbols", ct).ConfigureAwait(false)).Symbols;

    /// <summary>GET /markets/{exchange}/{symbol}/book — dual-unit snapshot; <paramref name="depth" /> = levels per side (1–500, default 50).</summary>
    public Task<Book> BookAsync(string exchange, string symbol, int? depth = null, CancellationToken ct = default) =>
        GetAsync<Book>($"/markets/{E(exchange)}/{E(symbol)}/book{(depth is null ? "" : $"?depth={depth}")}", ct);

    /// <summary>GET /markets/{exchange}/{symbol}/clusters — raw 15-second base buckets (merge timeframes yourself); <paramref name="limit" /> 1–17280 (72 h), default 240 = the last hour.</summary>
    public Task<Clusters> ClustersAsync(string exchange, string symbol, int? limit = null, CancellationToken ct = default) =>
        GetAsync<Clusters>($"/markets/{E(exchange)}/{E(symbol)}/clusters{(limit is null ? "" : $"?limit={limit}")}", ct);

    /// <summary>GET /markets/{exchange}/{symbol}/funding — perps only (spot answers 404 <c>unavailable</c>).</summary>
    public Task<Funding> FundingAsync(string exchange, string symbol, CancellationToken ct = default) =>
        GetAsync<Funding>($"/markets/{E(exchange)}/{E(symbol)}/funding", ct);

    // ── orderbook settings (exchange tier) ───────────────────────────────────
    /// <summary>GET /exchanges/{exchange}/orderbook-settings — the EFFECTIVE render settings for the venue.</summary>
    public Task<OrderbookSettingsResponse> OrderbookSettingsAsync(string exchange, CancellationToken ct = default) =>
        GetAsync<OrderbookSettingsResponse>($"/exchanges/{E(exchange)}/orderbook-settings", ct);

    /// <summary>PATCH /exchanges/{exchange}/orderbook-settings — partial update: only non-null fields change.</summary>
    public Task<OrderbookSettingsResponse> PatchOrderbookSettingsAsync(string exchange, OrderbookSettings patch, CancellationToken ct = default) =>
        SendAsync<OrderbookSettingsResponse>(HttpMethod.Patch, $"/exchanges/{E(exchange)}/orderbook-settings", patch, ct);

    // ── account (per connection) ─────────────────────────────────────────────
    public async Task<IReadOnlyList<Position>> PositionsAsync(string connectionId, CancellationToken ct = default) =>
        (await GetAsync<PositionsResponse>($"/connections/{E(connectionId)}/positions", ct).ConfigureAwait(false)).Positions;

    public async Task<IReadOnlyList<Order>> OrdersAsync(string connectionId, CancellationToken ct = default) =>
        (await GetAsync<OrdersResponse>($"/connections/{E(connectionId)}/orders", ct).ConfigureAwait(false)).Orders;

    public async Task<IReadOnlyList<Balance>> BalanceAsync(string connectionId, CancellationToken ct = default) =>
        (await GetAsync<BalanceResponse>($"/connections/{E(connectionId)}/balances", ct).ConfigureAwait(false)).Balances;

    /// <summary>
    ///     GET /connections/{id}/trades — CLOSED-trade history, newest close first.
    ///     <paramref name="fromMs" /> / <paramref name="toMs" /> bound the CLOSE time and are half-open
    ///     <c>[fromMs, toMs)</c>; a value the terminal cannot parse reads as "not supplied" rather than
    ///     erroring. <paramref name="page" /> is 1-based, <paramref name="pageSize" /> 1–500 (default
    ///     100). A row is AMENDABLE after it is written, so a poller should re-read rather than cache.
    /// </summary>
    public Task<ClosedTradesPage> ListTradesAsync(
        string connectionId,
        int? page = null,
        int? pageSize = null,
        string? symbol = null,
        long? fromMs = null,
        long? toMs = null,
        CancellationToken ct = default)
    {
        var q = new List<string>(5);
        if (page is { } p)
        {
            q.Add($"page={p}");
        }

        if (pageSize is { } ps)
        {
            q.Add($"pageSize={ps}");
        }

        if (!string.IsNullOrEmpty(symbol))
        {
            q.Add($"symbol={E(symbol)}");
        }

        if (fromMs is { } f)
        {
            q.Add($"fromMs={f}");
        }

        if (toMs is { } t)
        {
            q.Add($"toMs={t}");
        }

        var qs = q.Count > 0 ? "?" + string.Join("&", q) : "";
        return GetAsync<ClosedTradesPage>($"/connections/{E(connectionId)}/trades{qs}", ct);
    }

    /// <summary>
    ///     GET /connections/{id}/trades/{tradeId} — one closed trade WITH its individual fills, oldest
    ///     first. A trade that does not exist, belongs to another connection, or is hidden by the
    ///     phantom-spot-short rule all answer the same 404.
    /// </summary>
    public Task<ClosedTradeDetail> GetTradeAsync(string connectionId, long tradeId, CancellationToken ct = default) =>
        GetAsync<ClosedTradeDetail>($"/connections/{E(connectionId)}/trades/{tradeId}", ct);

    // ── trading (per-connection grant required) ──────────────────────────────
    /// <summary>
    ///     POST /connections/{id}/orders → 202 {clientOrderId, status}. The venue derives from the
    ///     connection, so the order body carries only the instrument + shape. Lifecycle then
    ///     arrives on the WS <c>orders</c> channel.
    /// </summary>
    public Task<OrderAccepted> PlaceOrderAsync(string connectionId, PlaceOrderRequest order, CancellationToken ct = default) =>
        SendAsync<OrderAccepted>(HttpMethod.Post, $"/connections/{E(connectionId)}/orders", order, ct);

    /// <summary>DELETE /connections/{id}/orders/{clientOrderId}?symbol= — cancel one order (symbol required).</summary>
    public Task CancelOrderAsync(string connectionId, string clientOrderId, string symbol, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Delete, $"/connections/{E(connectionId)}/orders/{E(clientOrderId)}?symbol={E(symbol)}", null, ct);

    /// <summary>
    ///     DELETE /connections/{id}/orders[?symbol=] — bulk cancel on one connection: with
    ///     <paramref name="symbol" /> every working order for that symbol; without, every order
    ///     across the whole account (positions untouched).
    /// </summary>
    public Task CancelOrdersAsync(string connectionId, string? symbol = null, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Delete, $"/connections/{E(connectionId)}/orders{(symbol is null ? "" : $"?symbol={E(symbol)}")}", null, ct);

    /// <summary>DELETE /connections/{id}/positions — close every position + cancel leftovers on one connection.</summary>
    public Task ClosePositionsAsync(string connectionId, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Delete, $"/connections/{E(connectionId)}/positions", null, ct);

    /// <summary>DELETE /orders — cancel every order on EVERY granted account.</summary>
    public Task<SweepResult> CancelAllOrdersAsync(CancellationToken ct = default) =>
        SendAsync<SweepResult>(HttpMethod.Delete, "/orders", null, ct);

    /// <summary>DELETE /positions — close every position + cancel leftovers on EVERY granted account.</summary>
    public Task<SweepResult> CloseAllPositionsAsync(CancellationToken ct = default) =>
        SendAsync<SweepResult>(HttpMethod.Delete, "/positions", null, ct);

    // ── panel control (/app/panels, api-version 2) ───────────────────────────
    // A SLOT is the durable box — its GUID Id survives an instrument change, a clear, a kind
    // transition, and a terminal restart, so a tool can drive the same box forever. A tab is ONE
    // layout tree where a leaf IS the slot. Add/change/clear are token-gated; a ConnectionId in a
    // body binds a trading account and needs a per-connection GRANT. A widget box is visible here
    // but never placed, changed or cleared through the API (409).

    /// <summary>The window → tab → layout tree; scope with <paramref name="tabId" /> (durable) / <paramref name="windowIndex" /> (positional).</summary>
    public async Task<IReadOnlyList<PanelWindow>> PanelsAsync(string? tabId = null, int? windowIndex = null, CancellationToken ct = default)
    {
        var q = new List<string>(2);
        if (!string.IsNullOrEmpty(tabId))
        {
            q.Add($"tabId={E(tabId)}");
        }

        if (windowIndex is { } wi)
        {
            q.Add($"windowIndex={wi}");
        }

        var qs = q.Count > 0 ? "?" + string.Join("&", q) : "";
        return (await GetAsync<PanelsResponse>($"/app/panels{qs}", ct).ConfigureAwait(false)).Windows;
    }

    /// <summary>One slot — byte-identical to its leaf in the tree — plus where it sits (parent split, path, depth).</summary>
    public Task<SlotLookup> PanelAsync(string slotId, CancellationToken ct = default) =>
        GetAsync<SlotLookup>($"/app/panels/{E(slotId)}", ct);

    /// <summary>
    ///     Add ONE box to a tab (the ACTIVE tab when <paramref name="tabId" /> is null — right-click
    ///     a tab header to copy its id). A null <paramref name="content" /> adds an empty "+" box —
    ///     reserve now, fill later by its durable id via <see cref="SetPanelAsync" />.
    ///     <paramref name="activate" /> surfaces the terminal window afterwards (default false so a
    ///     background layout tool never steals focus).
    /// </summary>
    public Task<SlotAction> AddPanelAsync(PanelContent? content = null, string? tabId = null, bool activate = false, CancellationToken ct = default) =>
        SendAsync<SlotAction>(HttpMethod.Post, "/app/panels", new { tabId, content, activate }, ct);

    /// <summary>
    ///     Add an ordered STACK of boxes (each item its own box, at most 16), optionally positioned by
    ///     <paramref name="target" /> (beside an existing slot — the drag-drop vocabulary; null =
    ///     appended to the tab's root row) and stacked per <paramref name="orientation" />
    ///     (<c>row</c> | <c>column</c>, null = column). <c>Slots</c> on the result is every box, in order.
    /// </summary>
    public Task<SlotAction> AddPanelsAsync(IReadOnlyList<PanelContent> contents, string? tabId = null, PanelTarget? target = null, string? orientation = null, bool activate = false, CancellationToken ct = default) =>
        SendAsync<SlotAction>(HttpMethod.Post, "/app/panels", new { tabId, contents, target, orientation, activate }, ct);

    /// <summary>
    ///     Idempotently set what ONE box holds — a kind transition is fine, the id never changes; a
    ///     chart docked beside the box is its own box and is left alone. A null
    ///     <paramref name="content" /> CLEARS the slot (the box stays and keeps its id). On a widget
    ///     box every set is refused (409).
    /// </summary>
    public Task<SlotAction> SetPanelAsync(string slotId, PanelContent? content = null, CancellationToken ct = default) =>
        SendAsync<SlotAction>(HttpMethod.Put, $"/app/panels/{E(slotId)}", new { content }, ct);

    /// <summary>Remove the slot entirely (its paired chart goes with it).</summary>
    public Task<SlotAction> RemovePanelAsync(string slotId, CancellationToken ct = default) =>
        SendAsync<SlotAction>(HttpMethod.Delete, $"/app/panels/{E(slotId)}", null, ct);

    // ── workspace (supersedes panel control; carries no api-version) ─────────
    // The terminal's WINDOWS, the TABS inside a window, the durable BOXES docked in a tab's layout
    // tree, and the CHART WINDOWS floating beside them. A tab's Layout is the very tree the panel
    // surface serves, so the node and content types are shared.

    /// <summary>
    ///     GET /app/workspace — every window with its tabs, layouts and chart windows. Scope it with
    ///     <paramref name="windowId" /> and/or <paramref name="tabId" />.
    /// </summary>
    public async Task<IReadOnlyList<WorkspaceWindow>> GetWorkspaceAsync(
        string? windowId = null,
        string? tabId = null,
        CancellationToken ct = default)
    {
        var q = new List<string>(2);
        if (!string.IsNullOrEmpty(windowId))
        {
            q.Add($"windowId={E(windowId)}");
        }

        if (!string.IsNullOrEmpty(tabId))
        {
            q.Add($"tabId={E(tabId)}");
        }

        var qs = q.Count > 0 ? "?" + string.Join("&", q) : "";
        return (await GetAsync<WorkspaceResponse>($"/app/workspace{qs}", ct).ConfigureAwait(false)).Windows;
    }

    /// <summary>GET /app/windows — the windows without any tab payload (<c>TabCount</c> instead of the tabs).</summary>
    public async Task<IReadOnlyList<WindowSummary>> ListWindowsAsync(CancellationToken ct = default) =>
        (await GetAsync<WindowsResponse>("/app/windows", ct).ConfigureAwait(false)).Windows;

    /// <summary>PATCH /app/windows/{windowId} — raise a window to the front. Only <c>{"active": true}</c> is meaningful.</summary>
    public Task<WindowAction> ActivateWindowAsync(string windowId, CancellationToken ct = default) =>
        SendAsync<WindowAction>(HttpMethod.Patch, $"/app/windows/{E(windowId)}", new { active = true }, ct);

    /// <summary>
    ///     POST /app/tabs → 201. <paramref name="windowId" /> null = the main window,
    ///     <paramref name="title" /> null = the automatic coin + count label, <paramref name="index" />
    ///     null = append. The new tab has no layout until something is added to it;
    ///     <paramref name="activate" /> surfaces it (false by default, so a background tool never
    ///     steals focus).
    /// </summary>
    public Task<TabAction> CreateTabAsync(
        string? windowId = null,
        string? title = null,
        int? index = null,
        bool activate = false,
        CancellationToken ct = default) =>
        SendAsync<TabAction>(HttpMethod.Post, "/app/tabs", new { windowId, title, index, activate }, ct);

    /// <summary>GET /app/tabs/{tabId} — the tab, byte-identical to its node in the workspace, plus where it sits.</summary>
    public Task<TabLookup> GetTabAsync(string tabId, CancellationToken ct = default) =>
        GetAsync<TabLookup>($"/app/tabs/{E(tabId)}", ct);

    /// <summary>
    ///     PATCH /app/tabs/{tabId} — rename, reorder and/or activate in one call (applied
    ///     title → index → active). Name at least one.
    ///     <para>
    ///         The name is TRI-STATE. Left alone by default; <paramref name="title" /> RENAMES;
    ///         <paramref name="clearTitle" /> sends <c>"title": null</c>, which restores the automatic
    ///         coin + count label. The terminal reads the KEY, not the value, so never feed
    ///         <paramref name="title" /> from a <see cref="GetTabAsync" /> you are round-tripping —
    ///         that freezes a rendered label such as <c>"BTC (3)"</c> as a permanent custom name.
    ///     </para>
    /// </summary>
    public Task<TabAction> UpdateTabAsync(
        string tabId,
        string? title = null,
        bool clearTitle = false,
        int? index = null,
        bool? active = null,
        bool? raiseWindow = null,
        CancellationToken ct = default)
    {
        // A dictionary, not a record: the shared options drop null PROPERTIES, which is what keeps
        // every other body clean — but dictionary VALUES are exempt, so this is the one place a
        // deliberate null can still reach the wire. A record could not express "present and null".
        var body = new Dictionary<string, object?>(4);
        if (clearTitle)
        {
            body["title"] = null;
        }
        else if (title is not null)
        {
            body["title"] = title;
        }

        if (index is not null)
        {
            body["index"] = index;
        }

        if (active is not null)
        {
            body["active"] = active;
        }

        if (raiseWindow is not null)
        {
            body["raiseWindow"] = raiseWindow;
        }

        if (body.Count == 0)
        {
            throw new ArgumentException("Name at least one of title, clearTitle, index or active.", nameof(title));
        }

        return SendAsync<TabAction>(HttpMethod.Patch, $"/app/tabs/{E(tabId)}", body, ct);
    }

    /// <summary>
    ///     DELETE /app/tabs/{tabId} — its slots, feeds and floating chart windows close with it.
    ///     Closing the last tab of a BOOK window closes the window; closing the last tab of the MAIN
    ///     window is refused (<c>409 last_tab</c>).
    /// </summary>
    public Task<TabRemoved> CloseTabAsync(string tabId, CancellationToken ct = default) =>
        SendAsync<TabRemoved>(HttpMethod.Delete, $"/app/tabs/{E(tabId)}", null, ct);

    /// <summary>
    ///     POST /app/slots → 201. ADDS boxes — <paramref name="target" /> names an ANCHOR that survives
    ///     with its id, its content and its live feed; it is never replaced. Build the target with
    ///     <see cref="SlotTarget.Beside" /> / <see cref="SlotTarget.AtEdge" /> (null =
    ///     <c>{"edge": "right"}</c>). <paramref name="stack" /> (<c>row</c> | <c>column</c>, null =
    ///     column) is how the NEW boxes arrange among THEMSELVES, and is ignored for a single box.
    ///     At most 16 — the per-widget panel cap charges one token per REQUEST.
    /// </summary>
    public Task<SlotsAdded> AddSlotsAsync(
        IReadOnlyList<NewSlot> slots,
        string? tabId = null,
        SlotTarget? target = null,
        string? stack = null,
        bool activate = false,
        CancellationToken ct = default) =>
        SendAsync<SlotsAdded>(HttpMethod.Post, "/app/slots", new { tabId, target, stack, slots, activate }, ct);

    /// <summary>GET /app/slots/{slotId} — the box and where it sits (window, tab, the index chain from the tab root, its parent split).</summary>
    public Task<WorkspaceSlotLookup> GetSlotAsync(string slotId, CancellationToken ct = default) =>
        GetAsync<WorkspaceSlotLookup>($"/app/slots/{E(slotId)}", ct);

    /// <summary>
    ///     PUT /app/slots/{slotId} — declare what THIS box holds. Idempotent, a kind transition is
    ///     legal, and the slot id never changes. <paramref name="content" /> is REQUIRED here, unlike
    ///     the deprecated <see cref="SetPanelAsync" /> where omitting it cleared the box — use
    ///     <see cref="ClearSlotAsync" /> for that. On a WIDGET box every set is refused (409), a clear
    ///     included.
    /// </summary>
    public Task<SlotChanged> SetSlotAsync(string slotId, SettableContent content, CancellationToken ct = default) =>
        SendAsync<SlotChanged>(HttpMethod.Put, $"/app/slots/{E(slotId)}", new { content }, ct);

    /// <summary>Clear the box — it stays on screen and keeps its id and its position.</summary>
    public Task<SlotChanged> ClearSlotAsync(string slotId, CancellationToken ct = default) =>
        SetSlotAsync(slotId, SettableContent.Empty, ct);

    /// <summary>DELETE /app/slots/{slotId} — structural: the box is gone and its id retired. A chart paired under an orderbook goes with it.</summary>
    public Task<SlotRemoved> RemoveSlotAsync(string slotId, CancellationToken ct = default) =>
        SendAsync<SlotRemoved>(HttpMethod.Delete, $"/app/slots/{E(slotId)}", null, ct);

    /// <summary>GET /app/chart-windows — the floating chart windows, each carrying the <c>TabId</c> that owns it. <paramref name="kind" /> filters to <c>chart</c> | <c>comboChart</c>.</summary>
    public async Task<IReadOnlyList<ChartWindow>> ListChartWindowsAsync(
        string? tabId = null,
        string? kind = null,
        CancellationToken ct = default)
    {
        var q = new List<string>(2);
        if (!string.IsNullOrEmpty(tabId))
        {
            q.Add($"tabId={E(tabId)}");
        }

        if (!string.IsNullOrEmpty(kind))
        {
            q.Add($"kind={E(kind)}");
        }

        var qs = q.Count > 0 ? "?" + string.Join("&", q) : "";
        return (await GetAsync<ChartWindowsResponse>($"/app/chart-windows{qs}", ct).ConfigureAwait(false)).ChartWindows;
    }

    /// <summary>
    ///     POST /app/chart-windows → <b>200 or 201</b>. 201 opened a window; 200 means that
    ///     (<paramref name="kind" />, <paramref name="exchange" />, <paramref name="symbol" />) was
    ///     already open and the live window was re-homed and shown — not an error, and not a new
    ///     window. <paramref name="interval" /> is <c>chart</c> only (null = the app default M5);
    ///     <paramref name="intervals" /> is exactly three and <c>comboChart</c> only (null = M5/M15/H1).
    /// </summary>
    public Task<ChartWindowAction> OpenChartWindowAsync(
        string kind,
        string exchange,
        string symbol,
        string? interval = null,
        IReadOnlyList<string>? intervals = null,
        string? tabId = null,
        bool activate = false,
        CancellationToken ct = default) =>
        SendAsync<ChartWindowAction>(
            HttpMethod.Post,
            "/app/chart-windows",
            new { kind, exchange, symbol, interval, intervals, tabId, activate },
            ct);

    /// <summary>
    ///     PATCH /app/chart-windows/{chartWindowId} — retarget, re-interval, re-home, pin, lock or
    ///     raise. Name at least one. <paramref name="interval" /> is <c>chart</c> only;
    ///     <paramref name="intervals" /> and <paramref name="sync" /> are <c>comboChart</c> only;
    ///     <paramref name="active" /> takes only true (it raises the window). <paramref name="sync" />
    ///     is EXCLUSIVE across combo windows and the answer reports only THIS window, so re-read
    ///     <see cref="ListChartWindowsAsync" /> to see what it turned off.
    /// </summary>
    public Task<ChartWindowAction> UpdateChartWindowAsync(
        string chartWindowId,
        string? exchange = null,
        string? symbol = null,
        string? interval = null,
        IReadOnlyList<string>? intervals = null,
        string? tabId = null,
        bool? pinned = null,
        bool? locked = null,
        bool? sync = null,
        bool? active = null,
        CancellationToken ct = default) =>
        SendAsync<ChartWindowAction>(
            HttpMethod.Patch,
            $"/app/chart-windows/{E(chartWindowId)}",
            new { exchange, symbol, interval, intervals, tabId, pinned, locked, sync, active },
            ct);

    /// <summary>DELETE /app/chart-windows/{chartWindowId} — close it.</summary>
    public Task<ChartWindowRemoved> CloseChartWindowAsync(string chartWindowId, CancellationToken ct = default) =>
        SendAsync<ChartWindowRemoved>(HttpMethod.Delete, $"/app/chart-windows/{E(chartWindowId)}", null, ct);

    // ── app bridge / signals ─────────────────────────────────────────────────
    /// <summary>
    ///     Open ONE coin in the ACTIVE tab + surface the window — a convenience wrapper over
    ///     <see cref="AddPanelAsync" /> with <c>activate: true</c> (201, returns the created slot).
    ///     <paramref name="connectionId" /> is grant-gated; <paramref name="views" /> defaults to
    ///     <c>["orderbook"]</c>.
    /// </summary>
    public Task<SlotAction> OpenSymbolAsync(string exchange, string symbol, string? connectionId = null, IReadOnlyList<string>? views = null, CancellationToken ct = default) =>
        AddPanelAsync(new PanelContent(exchange, symbol, views ?? ["orderbook"], connectionId), activate: true, ct: ct);

    /// <summary>POST /app/combos — fan the coin across every connection that lists it. <paramref name="target" />: "tab" | "window".</summary>
    public Task OpenComboAsync(string symbol, string target = "window", CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/app/combos", new { symbol, target }, ct);

    /// <summary>POST /notifications — raise a toast. Severity: info | success | warning | error.</summary>
    public Task NotifyAsync(string message, string severity = "info", string? source = null, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/notifications", new { message, severity, source }, ct);

    /// <summary>POST /signals — post a free-text market signal into Notifications → API tab.</summary>
    public Task SignalAsync(string exchange, string symbol, string text, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/signals", new { exchange, symbol, text }, ct);

    // ── signal levels (API-owned price alerts, drawn on the ladder) ──────────
    /// <summary>GET /signal-levels — filter by venue / symbol.</summary>
    public async Task<IReadOnlyList<SignalLevel>> SignalLevelsAsync(string? exchange = null, string? symbol = null, CancellationToken ct = default)
    {
        var q = new List<string>(2);
        if (!string.IsNullOrEmpty(exchange))
        {
            q.Add($"exchange={E(exchange)}");
        }

        if (!string.IsNullOrEmpty(symbol))
        {
            q.Add($"symbol={E(symbol)}");
        }

        var qs = q.Count > 0 ? "?" + string.Join("&", q) : "";
        return (await GetAsync<SignalLevelsResponse>($"/signal-levels{qs}", ct).ConfigureAwait(false)).Levels;
    }

    /// <summary>
    ///     POST /signal-levels → 201. A level fires at most once: <paramref name="oneShot" />
    ///     removes it on fire, else it is kept marked triggered (sweep via
    ///     <see cref="DeleteTriggeredSignalLevelsAsync" />). A level is a pure market alert —
    ///     venue + symbol only, never tied to a connection.
    /// </summary>
    public Task<SignalLevel> CreateSignalLevelAsync(
        string exchange,
        string symbol,
        string price,
        string direction = "cross",
        string? note = null,
        bool oneShot = false,
        CancellationToken ct = default) =>
        SendAsync<SignalLevel>(HttpMethod.Post, "/signal-levels", new { exchange, symbol, price, direction, note, oneShot }, ct);

    /// <summary>DELETE /signal-levels/{id} → {removed: 1}.</summary>
    public Task<SignalLevelRemoved> DeleteSignalLevelAsync(string id, CancellationToken ct = default) =>
        SendAsync<SignalLevelRemoved>(HttpMethod.Delete, $"/signal-levels/{E(id)}", null, ct);

    /// <summary>DELETE /signal-levels?exchange=&amp;symbol= — clear every level of one symbol.</summary>
    public Task<SignalLevelRemoved> DeleteSignalLevelsAsync(string exchange, string symbol, CancellationToken ct = default) =>
        SendAsync<SignalLevelRemoved>(HttpMethod.Delete, $"/signal-levels?exchange={E(exchange)}&symbol={E(symbol)}", null, ct);

    /// <summary>DELETE /signal-levels/triggered — sweep every fired level (all venues/symbols/connections).</summary>
    public Task<SignalLevelRemoved> DeleteTriggeredSignalLevelsAsync(CancellationToken ct = default) =>
        SendAsync<SignalLevelRemoved>(HttpMethod.Delete, "/signal-levels/triggered", null, ct);

    // ── streaming ────────────────────────────────────────────────────────────
    public ColibriSocket Stream() => new(Base, Token);

    public void Dispose() => _http.Dispose();

    private sealed record ConnectionsResponse(IReadOnlyList<Connection> Connections);
    private sealed record PanelsResponse(IReadOnlyList<PanelWindow> Windows);
    private sealed record ExchangesResponse(IReadOnlyList<ExchangeInfo> Exchanges);
    private sealed record SymbolsResponse(string Exchange, IReadOnlyList<SymbolInfo> Symbols);
    private sealed record PositionsResponse(string ConnectionId, IReadOnlyList<Position> Positions);
    private sealed record OrdersResponse(string ConnectionId, IReadOnlyList<Order> Orders);
    private sealed record BalanceResponse(string ConnectionId, IReadOnlyList<Balance> Balances);
    private sealed record SignalLevelsResponse(IReadOnlyList<SignalLevel> Levels);
    private sealed record WorkspaceResponse(IReadOnlyList<WorkspaceWindow> Windows);
    private sealed record WindowsResponse(IReadOnlyList<WindowSummary> Windows);
    private sealed record ChartWindowsResponse(IReadOnlyList<ChartWindow> ChartWindows);
}
