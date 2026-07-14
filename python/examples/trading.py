"""Trading — place, cancel, bulk cancel, all-granted sweeps. GRANT-GATED.

SAFETY: this places a REAL order. It is a no-op unless armed:
    COLIBRI_ARM=1 python examples/trading.py
It uses a far-from-market LIMIT so it rests without filling.
"""
import os

from colibri import ColibriClient

ARMED = os.environ.get("COLIBRI_ARM") == "1"
client = ColibriClient.discover()
EXCHANGE, SYMBOL = "BinanceSpot", "BTCUSDT"

# The venue derives from the connection — the order body carries neither connectionId nor exchange.
conn = next((c for c in client.connections() if c["apiTradingEnabled"] and c["exchange"] == EXCHANGE), None)
if conn is None:
    raise SystemExit(f"no trading-granted {EXCHANGE} connection — enable a grant in Settings -> Program -> Local API")

book = client.book(EXCHANGE, SYMBOL)
rest_price = f"{float(book['bestBid']) * 0.5:.2f}"  # 50% below market -> will not fill

if not ARMED:
    print("DRY RUN (set COLIBRI_ARM=1 to actually trade). Would place on", conn["id"], ":")
    print({"symbol": SYMBOL, "side": "BUY", "type": "Limit", "price": rest_price, "sizeQuote": "10"})
    raise SystemExit(0)

# POST /connections/{id}/orders  -> 202 {clientOrderId, status}; lifecycle then on the WS `orders` channel
placed = client.place_order(conn["id"], SYMBOL, side="BUY", type="Limit", price=rest_price, size_quote="10")
print("placed:", placed)

# DELETE /connections/{id}/orders/{clientOrderId}?symbol=
client.cancel_order(conn["id"], placed["clientOrderId"], SYMBOL)
print("cancelled", placed["clientOrderId"])

# DELETE /connections/{id}/orders?symbol=  — every working order for this symbol
client.cancel_all(conn["id"], SYMBOL)
print("cancel-all (symbol) done")

# DELETE /connections/{id}/orders  — every order on the whole account (positions untouched)
# client.cancel_all(conn["id"])

# DELETE /connections/{id}/positions  — close every position + cancel leftovers on this account
# client.close_positions(conn["id"])

# All-granted sweeps — EVERY granted account, one call (the terminal's global hotkey scopes):
print("sweep cancel-all-orders:", client.cancel_all_orders())   # DELETE /orders
# print("sweep close-all-positions:", client.close_all_positions())  # DELETE /positions
