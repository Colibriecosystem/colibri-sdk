"""App bridge + notifications + signal levels — drive the terminal from a widget.

    python examples/app_and_signals.py
"""
from colibri import ColibriClient

client = ColibriClient.discover()
EXCHANGE, SYMBOL = "BinanceSpot", "BTCUSDT"

# POST /app/open-symbol  — open one coin on its venue
print("open-symbol:", client.open_symbol(EXCHANGE, SYMBOL))

# POST /app/open-combo  — fan across every connection that lists it
print("open-combo:", client.open_combo(SYMBOL, target="window"))

# POST /notifications  — raise a toast
print("notify:", client.notify("Hello from a widget", severity="info", source="my-widget"))

# POST /signals  — free-text market signal into Notifications -> API tab
print("signal:", client.signal(EXCHANGE, SYMBOL, "whale wall pulled"))

# Signal levels — API-owned price alerts, also drawn on the ladder.
last = float(client.book(EXCHANGE, SYMBOL)["lastPrice"])

# POST /signal-levels
level = client.create_signal_level(EXCHANGE, SYMBOL, price=f"{last * 1.02:.2f}", direction="above", note="breakout watch", one_shot=True)
print("\ncreated level:", level["id"], "@", level["price"])

# GET /signal-levels?exchange=&symbol=
print("levels now:", [f"{l['price']} ({l['direction']})" for l in client.signal_levels(EXCHANGE, SYMBOL)])

# DELETE /signal-levels/{id}
client.delete_signal_level(level["id"])
print("deleted", level["id"])
