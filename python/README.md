# Colibri Local API — Python SDK

```bash
pip install websocket-client   # only needed for the streaming socket
```

```python
from colibri import ColibriClient

client = ColibriClient.discover()          # reads %APPDATA%\Colibri\localapi.json
print(client.ping())

book = client.book("BinanceSpot", "BTCUSDT", depth=10)
print(book["bestBid"], book["bestAsk"])

# live trades
ws = client.stream()
ws.on("trades", lambda data, frame: print(data["trades"]))
ws.connect()
ws.subscribe("trades", exchange="BinanceSpot", symbol="BTCUSDT")
ws.run_forever()
```

REST is zero-dependency (stdlib `urllib`); the WebSocket socket needs `websocket-client`.
See [`examples/`](examples/) and the [full API reference](../docs/Colibri-Api.md).
