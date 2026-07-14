using System.Net.Http.Json;
using System.Text.Json;

namespace Colibri.Sdk;

/// <summary>An API error carrying the parsed <c>{code, message}</c> (or the HTTP status).</summary>
public sealed class ColibriException(int status, string code, string message) : Exception($"[{status} {code}] {message}")
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

/// <summary>
///     REST client for the Colibri Local API. Reads work with the token; trading needs a per-connection
///     grant (Settings → Program → Local API). Every number on the wire is a decimal string.
/// </summary>
public sealed class ColibriClient : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _http;

    public ColibriClient(int port, string token, string host = "127.0.0.1")
    {
        _http = new HttpClient { BaseAddress = new Uri($"http://{host}:{port}") };
        _http.DefaultRequestHeaders.Authorization = new("Bearer", token);
        Base = _http.BaseAddress;
        Token = token;
    }

    public Uri Base { get; }
    public string Token { get; }

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
    /// <summary>Liveness + version + the live bound port — the one token-free route.</summary>
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

    /// <summary>GET /markets/{exchange}/{symbol}/clusters — raw 1-minute buckets (merge timeframes yourself); <paramref name="limit" /> 1–4320.</summary>
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

    /// <summary>DELETE /orders — emergency sweep: cancel every order on EVERY granted account.</summary>
    public Task<SweepResult> CancelAllOrdersAsync(CancellationToken ct = default) =>
        SendAsync<SweepResult>(HttpMethod.Delete, "/orders", null, ct);

    /// <summary>DELETE /positions — emergency sweep: close every position + cancel leftovers on EVERY granted account.</summary>
    public Task<SweepResult> CloseAllPositionsAsync(CancellationToken ct = default) =>
        SendAsync<SweepResult>(HttpMethod.Delete, "/positions", null, ct);

    // ── panel control (/app/panels) ──────────────────────────────────────────
    // A SLOT is the durable box — its GUID slotId survives an instrument change, a clear, and a
    // terminal restart. Add/change/clear are token-gated; a connectionId binds a trading account
    // and needs a per-connection GRANT (like trading).

    /// <summary>The window → tab → slot tree; scope with <paramref name="tabId" /> (durable) / <paramref name="windowIndex" /> (positional).</summary>
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

    /// <summary>
    ///     Add a panel to a tab (the ACTIVE tab when <paramref name="tabId" /> is null — right-click a
    ///     tab header to copy its id). A null <paramref name="content" /> adds an empty "+" box
    ///     instead — reserve now, fill later by its durable id via <see cref="SetPanelAsync" />.
    ///     <paramref name="activate" /> surfaces the terminal window afterwards (default false so a
    ///     background layout tool never steals focus).
    /// </summary>
    public Task<PanelActionResult> AddPanelAsync(PanelContent? content = null, string? tabId = null, bool activate = false, CancellationToken ct = default) =>
        SendAsync<PanelActionResult>(HttpMethod.Post, "/app/panels", new { tabId, content, activate }, ct);

    /// <summary>
    ///     Idempotently set a slot's desired state — instrument, views (kind transitions ok: an
    ///     orderbook box can become a chart box and back, the id never changes), account. A null
    ///     <paramref name="content" /> CLEARS the slot (the box stays and keeps its id).
    /// </summary>
    public Task<PanelActionResult> SetPanelAsync(string slotId, PanelContent? content = null, CancellationToken ct = default) =>
        SendAsync<PanelActionResult>(HttpMethod.Put, $"/app/panels/{E(slotId)}", new { content }, ct);

    /// <summary>Remove the slot entirely (its paired chart goes with it).</summary>
    public Task<PanelActionResult> RemovePanelAsync(string slotId, CancellationToken ct = default) =>
        SendAsync<PanelActionResult>(HttpMethod.Delete, $"/app/panels/{E(slotId)}", null, ct);

    // ── app bridge / signals ─────────────────────────────────────────────────
    /// <summary>
    ///     Open ONE coin in the ACTIVE tab + surface the window — a convenience wrapper over
    ///     <see cref="AddPanelAsync" /> with <c>activate: true</c> (201, returns the created slot).
    ///     <paramref name="connectionId" /> is grant-gated; <paramref name="views" /> defaults to
    ///     <c>["orderbook"]</c>.
    /// </summary>
    public Task<PanelActionResult> OpenSymbolAsync(string exchange, string symbol, string? connectionId = null, IReadOnlyList<string>? views = null, CancellationToken ct = default) =>
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
}
