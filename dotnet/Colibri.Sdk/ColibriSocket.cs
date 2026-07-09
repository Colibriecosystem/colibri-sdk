using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Colibri.Sdk;

/// <summary>A decoded <c>/stream</c> frame: <c>type</c> is the channel (or "error"), <c>data</c> the payload.</summary>
public readonly record struct StreamFrame(string Type, string? Event, JsonElement Data);

/// <summary>
///     WebSocket client for <c>/stream</c>. Subscribe to book / trades / funding / positions / orders /
///     balance / notifications / signalLevels. The token rides <c>?access_token=</c> (browsers can't set
///     the header; this client matches that path).
/// </summary>
public sealed class ColibriSocket : IAsyncDisposable
{
    private readonly Uri _url;
    private readonly ClientWebSocket _ws = new();
    private readonly Dictionary<string, List<Action<StreamFrame>>> _handlers = new();
    private CancellationTokenSource? _cts;

    public ColibriSocket(Uri httpBase, string token)
    {
        var scheme = httpBase.Scheme == "https" ? "wss" : "ws";
        _url = new Uri($"{scheme}://{httpBase.Authority}/stream?access_token={Uri.EscapeDataString(token)}");
    }

    /// <summary>Register a handler for a channel name, "error", or "*" (every frame).</summary>
    public ColibriSocket On(string channel, Action<StreamFrame> handler)
    {
        if (!_handlers.TryGetValue(channel, out var list))
        {
            _handlers[channel] = list = [];
        }

        list.Add(handler);
        return this;
    }

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        await _ws.ConnectAsync(_url, ct).ConfigureAwait(false);
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _ = ReceiveLoopAsync(_cts.Token);
    }

    public Task SubscribeAsync(string channel, object? extra = null, CancellationToken ct = default) =>
        SendAsync(new { type = "subscribe", data = Merge(channel, extra) }, ct);

    public Task UnsubscribeAsync(string channel, object? extra = null, CancellationToken ct = default) =>
        SendAsync(new { type = "unsubscribe", data = Merge(channel, extra) }, ct);

    private static Dictionary<string, object?> Merge(string channel, object? extra)
    {
        var map = new Dictionary<string, object?> { ["channel"] = channel };
        if (extra is not null)
        {
            foreach (var p in extra.GetType().GetProperties())
            {
                map[JsonNamingPolicy.CamelCase.ConvertName(p.Name)] = p.GetValue(extra);
            }
        }

        return map;
    }

    private async Task SendAsync(object frame, CancellationToken ct)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(frame, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await _ws.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, ct).ConfigureAwait(false);
    }

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        var sb = new StringBuilder();
        try
        {
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                var result = await _ws.ReceiveAsync(buffer, ct).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }

                sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                if (!result.EndOfMessage)
                {
                    continue;
                }

                Dispatch(sb.ToString());
                sb.Clear();
            }
        }
        catch (OperationCanceledException) { /* disposed */ }
    }

    private void Dispatch(string raw)
    {
        JsonElement root;
        try
        {
            root = JsonDocument.Parse(raw).RootElement;
        }
        catch (JsonException)
        {
            return;
        }

        var type = root.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
        var ev = root.TryGetProperty("event", out var e) ? e.GetString() : null;
        var data = root.TryGetProperty("data", out var d) ? d : root;
        var frame = new StreamFrame(type, ev, data);

        foreach (var key in new[] { type, "*" })
        {
            if (_handlers.TryGetValue(key, out var list))
            {
                foreach (var h in list)
                {
                    h(frame);
                }
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts?.Cancel();
        if (_ws.State == WebSocketState.Open)
        {
            try
            {
                await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).ConfigureAwait(false);
            }
            catch (WebSocketException) { /* already closing */ }
        }

        _ws.Dispose();
        _cts?.Dispose();
    }
}
