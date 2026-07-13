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
            var code = $"http_{(int)res.StatusCode}";
            var message = text;
            try
            {
                using var doc = JsonDocument.Parse(text);
                if (doc.RootElement.TryGetProperty("error", out var err))
                {
                    code = err.TryGetProperty("code", out var c) ? c.GetString() ?? code : code;
                    message = err.TryGetProperty("message", out var m) ? m.GetString() ?? message : message;
                }
            }
            catch (JsonException) { /* non-JSON body — keep the raw text */ }

            throw new ColibriException((int)res.StatusCode, code, message);
        }

        return string.IsNullOrEmpty(text) ? default! : JsonSerializer.Deserialize<T>(text, Json)!;
    }

    // ── discovery / connections ──────────────────────────────────────────────
    public Task<Ping> PingAsync(CancellationToken ct = default) => GetAsync<Ping>("/ping", ct);

    public async Task<IReadOnlyList<Connection>> ConnectionsAsync(CancellationToken ct = default) =>
        (await GetAsync<ConnectionsResponse>("/connections", ct).ConfigureAwait(false)).Connections;

    public Task<Connection> ConnectionAsync(string id, CancellationToken ct = default) =>
        GetAsync<Connection>($"/connections/{Uri.EscapeDataString(id)}", ct);

    // ── market data ──────────────────────────────────────────────────────────
    /// <summary>The venue catalog — <c>Id</c> is the string every exchange param accepts; <c>Trading:false</c> = view-only venue.</summary>
    public async Task<IReadOnlyList<ExchangeInfo>> ExchangesAsync(CancellationToken ct = default) =>
        (await GetAsync<ExchangesResponse>("/exchanges", ct).ConfigureAwait(false)).Exchanges;

    public async Task<IReadOnlyList<SymbolInfo>> SymbolsAsync(string exchange, CancellationToken ct = default) =>
        (await GetAsync<SymbolsResponse>($"/symbols?exchange={Uri.EscapeDataString(exchange)}", ct).ConfigureAwait(false)).Symbols;

    public Task<Book> BookAsync(string exchange, string symbol, int? depth = null, CancellationToken ct = default) =>
        GetAsync<Book>($"/book/{exchange}/{symbol}{(depth is null ? "" : $"?depth={depth}")}", ct);

    public Task<Funding> FundingAsync(string exchange, string symbol, CancellationToken ct = default) =>
        GetAsync<Funding>($"/funding/{exchange}/{symbol}", ct);

    // ── account ──────────────────────────────────────────────────────────────
    public async Task<IReadOnlyList<Position>> PositionsAsync(string connectionId, CancellationToken ct = default) =>
        (await GetAsync<PositionsResponse>($"/positions?connectionId={Uri.EscapeDataString(connectionId)}", ct).ConfigureAwait(false)).Positions;

    public async Task<IReadOnlyList<Order>> OrdersAsync(string connectionId, CancellationToken ct = default) =>
        (await GetAsync<OrdersResponse>($"/orders?connectionId={Uri.EscapeDataString(connectionId)}", ct).ConfigureAwait(false)).Orders;

    public async Task<IReadOnlyList<Balance>> BalanceAsync(string connectionId, CancellationToken ct = default) =>
        (await GetAsync<BalanceResponse>($"/balance?connectionId={Uri.EscapeDataString(connectionId)}", ct).ConfigureAwait(false)).Balances;

    // ── trading (per-connection grant required) ──────────────────────────────
    public Task<OrderAccepted> PlaceOrderAsync(PlaceOrderRequest order, CancellationToken ct = default) =>
        SendAsync<OrderAccepted>(HttpMethod.Post, "/orders", order, ct);

    public Task CancelOrderAsync(string clientOrderId, string connectionId, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Delete, $"/orders/{Uri.EscapeDataString(clientOrderId)}?connectionId={Uri.EscapeDataString(connectionId)}", null, ct);

    public Task CancelAllAsync(string connectionId, string exchange, string symbol, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/orders/cancelAll", new { connectionId, exchange, symbol }, ct);

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
            q.Add($"tabId={Uri.EscapeDataString(tabId)}");
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
    /// </summary>
    public Task<PanelActionResult> AddPanelAsync(PanelContent? content = null, string? tabId = null, CancellationToken ct = default) =>
        SendAsync<PanelActionResult>(HttpMethod.Post, "/app/panels", new { tabId, content }, ct);

    /// <summary>
    ///     Idempotently set a slot's desired state — instrument, views (kind transitions ok: an
    ///     orderbook box can become a chart box and back, the id never changes), account. A null
    ///     <paramref name="content" /> CLEARS the slot (the box stays and keeps its id).
    /// </summary>
    public Task<PanelActionResult> SetPanelAsync(string slotId, PanelContent? content = null, CancellationToken ct = default) =>
        SendAsync<PanelActionResult>(HttpMethod.Put, $"/app/panels/{Uri.EscapeDataString(slotId)}", new { content }, ct);

    /// <summary>Remove the slot entirely (its paired chart goes with it).</summary>
    public Task<PanelActionResult> RemovePanelAsync(string slotId, CancellationToken ct = default) =>
        SendAsync<PanelActionResult>(HttpMethod.Delete, $"/app/panels/{Uri.EscapeDataString(slotId)}", null, ct);

    // ── app bridge / signals ─────────────────────────────────────────────────
    /// <summary>
    ///     Open ONE coin in the ACTIVE tab + surface the window — a panel add under the hood (201,
    ///     returns the created slot). <paramref name="connectionId" /> is grant-gated;
    ///     <paramref name="views" /> defaults to <c>["orderbook"]</c>.
    /// </summary>
    public Task<PanelActionResult> OpenSymbolAsync(string exchange, string symbol, string? connectionId = null, IReadOnlyList<string>? views = null, CancellationToken ct = default) =>
        SendAsync<PanelActionResult>(HttpMethod.Post, "/app/open-symbol", new { exchange, symbol, connectionId, views }, ct);

    /// <summary>Account-wide: cancel every order (regular + triggers) — one account, or every granted one when null.</summary>
    public Task CancelAllOrdersAsync(string? connectionId = null, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/orders/cancel-all-orders", new { connectionId }, ct);

    /// <summary>Account-wide: close every position + cancel leftovers — one account, or every granted one when null.</summary>
    public Task CloseAllPositionsAsync(string? connectionId = null, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/orders/close-all-positions", new { connectionId }, ct);

    public Task OpenComboAsync(string symbol, string target = "window", CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/app/open-combo", new { symbol, target }, ct);

    public Task NotifyAsync(string message, string severity = "info", string? source = null, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/notifications", new { message, severity, source }, ct);

    public Task SignalAsync(string exchange, string symbol, string text, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/signals", new { exchange, symbol, text }, ct);

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
}
