"""Live trades: subscribe to the `trades` channel and print each print.

Requires websocket-client:  pip install websocket-client

    python examples/live_trades.py
"""
from colibri import ColibriClient

client = ColibriClient.discover()
ws = client.stream()


def on_trades(data, _frame):
    for t in data.get("trades", []):
        side = "BUY " if t["isBuy"] else "SELL"
        print(f"{side}  {t['qty']} @ {t['price']}")


ws.on("trades", on_trades)
ws.connect()
ws.subscribe("trades", exchange="BinanceSpot", symbol="BTCUSDT")

print("streaming BTCUSDT trades — Ctrl+C to stop")
ws.run_forever()
