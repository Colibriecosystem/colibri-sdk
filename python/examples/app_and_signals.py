"""App bridge + notifications + signal levels — drive the terminal from a widget.

    python examples/app_and_signals.py
"""
from colibri import ColibriClient

client = ColibriClient.discover()
EXCHANGE, SYMBOL = "BinanceSpot", "BTCUSDT"

# open_symbol — open one coin + surface the window (a POST /app/panels {activate: true} under the hood)
print("open-symbol:", client.open_symbol(EXCHANGE, SYMBOL))

# POST /app/combos  — fan across every connection that lists it
print("combo:", client.open_combo(SYMBOL, target="window"))

# POST /notifications  — raise a toast
print("notify:", client.notify("Hello from a widget", severity="info", source="my-widget"))

# POST /signals  — free-text market signal into Notifications -> API tab
print("signal:", client.signal(EXCHANGE, SYMBOL, "whale wall pulled"))

# Signal levels — API-owned price alerts, also drawn on the ladder.
last = float(client.book(EXCHANGE, SYMBOL)["lastPrice"])

# POST /signal-levels  -> 201. A level fires AT MOST ONCE: one_shot removes it on fire, otherwise
# it is kept marked isTriggered (sweep those with delete_triggered_signal_levels()).
level = client.create_signal_level(EXCHANGE, SYMBOL, price=f"{last * 1.02:.2f}", direction="above", note="breakout watch", one_shot=True)
print("\ncreated level:", level["id"], "@", level["price"], "triggered:", level["isTriggered"])

# GET /signal-levels?exchange=&symbol=  (a connectionId filter is available too)
print("levels now:", [f"{l['price']} ({l['direction']})" for l in client.signal_levels(EXCHANGE, SYMBOL)])

# DELETE /signal-levels/{id}
print("deleted:", client.delete_signal_level(level["id"]))

# DELETE /signal-levels/triggered  — sweep every already-fired level
print("swept fired levels:", client.delete_triggered_signal_levels())
