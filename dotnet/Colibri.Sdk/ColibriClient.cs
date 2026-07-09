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

    // ── app bridge / signals ─────────────────────────────────────────────────
    public Task OpenSymbolAsync(string exchange, string symbol, CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, "/app/open-symbol", new { exchange, symbol }, ct);

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
    private sealed record SymbolsResponse(string Exchange, IReadOnlyList<SymbolInfo> Symbols);
    private sealed record PositionsResponse(string ConnectionId, IReadOnlyList<Position> Positions);
    private sealed record OrdersResponse(string ConnectionId, IReadOnlyList<Order> Orders);
    private sealed record BalanceResponse(string ConnectionId, IReadOnlyList<Balance> Balances);
}
