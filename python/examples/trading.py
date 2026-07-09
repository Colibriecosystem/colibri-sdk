"""Trading — place, cancel, cancel-all, panic. GRANT-GATED.

SAFETY: this places a REAL order. It is a no-op unless armed:
    COLIBRI_ARM=1 python examples/trading.py
It uses a far-from-market LIMIT so it rests without filling.
"""
import os

from colibri import ColibriClient

ARMED = os.environ.get("COLIBRI_ARM") == "1"
client = ColibriClient.discover()
EXCHANGE, SYMBOL = "BinanceSpot", "BTCUSDT"

conn = next((c for c in client.connections() if c["apiTradingEnabled"]), None)
if conn is None:
    raise SystemExit("no trading-granted connection — enable a grant in Settings -> Program -> Local API")

book = client.book(EXCHANGE, SYMBOL)
rest_price = f"{float(book['bestBid']) * 0.5:.2f}"  # 50% below market -> will not fill

if not ARMED:
    print("DRY RUN (set COLIBRI_ARM=1 to actually trade). Would place:")
    print({"connectionId": conn["id"], "exchange": EXCHANGE, "symbol": SYMBOL,
           "side": "BUY", "type": "LIMIT", "price": rest_price, "sizeQuote": "10"})
    raise SystemExit(0)

# POST /orders  -> 202 {clientOrderId, status}; lifecycle then on the WS `orders` channel
placed = client.place_order(conn["id"], EXCHANGE, SYMBOL, side="BUY", type="LIMIT", price=rest_price, size_quote="10")
print("placed:", placed)

# DELETE /orders/{clientOrderId}?connectionId=
client.cancel_order(placed["clientOrderId"], conn["id"])
print("cancelled", placed["clientOrderId"])

# POST /orders/cancelAll
client.cancel_all(conn["id"], EXCHANGE, SYMBOL)
print("cancel-all done")

# POST /panic/cancel-all-orders  (omit id -> every granted account)
print("panic cancel-all-orders:", client.panic_cancel_all_orders(conn["id"]))

# POST /panic/close-all-positions  (flatten + cancel)
# print(client.panic_close_all_positions(conn["id"]))
