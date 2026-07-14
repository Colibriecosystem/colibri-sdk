"""Streaming — every WebSocket channel on /stream.

Requires:  pip install websocket-client

    python examples/stream_all.py
"""
from colibri import ColibriClient

client = ColibriClient.discover()
EXCHANGE, SYMBOL = "BinanceSpot", "BTCUSDT"

conn = (client.connections() or [None])[0]  # for the account channels

ws = client.stream()

# Market channels — keyed by exchange + symbol.
ws.on("book", lambda d, f: print("[book]", d.get("bestBid"), "/", d.get("bestAsk")))
ws.on("trades", lambda d, f: print("[trades]", len(d.get("trades", [])), "prints"))
ws.on("funding", lambda d, f: print("[funding]", d))

# Account channels — keyed by connectionId.
ws.on("positions", lambda d, f: print("[positions]", d))
ws.on("orders", lambda d, f: print("[orders]", d))
ws.on("balance", lambda d, f: print("[balance]", d))

# App-wide channels. NB the pushed frame types are SINGULAR ("notification" / "signalLevel")
# even though the subscribed channels are plural.
ws.on("notification", lambda d, f: print("[notification]", d))
ws.on("signalLevel", lambda d, f: print("[signalLevel]", f.get("event"), d))

ws.on("error", lambda d, f: print("[error]", d))

ws.connect()

ws.subscribe("book", exchange=EXCHANGE, symbol=SYMBOL, hz=2, depth=20)
ws.subscribe("trades", exchange=EXCHANGE, symbol=SYMBOL)
ws.subscribe("funding", exchange="BinanceLinearFutures", symbol=SYMBOL)
ws.subscribe("notifications")
ws.subscribe("signalLevels")
if conn is not None:
    ws.subscribe("positions", connectionId=conn["id"])
    ws.subscribe("orders", connectionId=conn["id"])
    ws.subscribe("balance", connectionId=conn["id"])

print("subscribed to all channels — Ctrl+C to stop")
ws.run_forever()
