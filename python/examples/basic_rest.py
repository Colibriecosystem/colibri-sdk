"""Basic REST: discover the running terminal, list connections, read a book snapshot.

    python examples/basic_rest.py
"""
from colibri import ColibriClient

client = ColibriClient.discover()  # reads %APPDATA%\Colibri\localapi.json

ping = client.ping()
print(f"Connected to {ping['name']} {ping['version']} (API {ping['apiVersion']})")

for c in client.connections():
    print(f"- {c['label'] or c['exchange']} [{c['marketType']}]  trading={c['apiTradingEnabled']}  demo={c['demo']}")

book = client.book("BinanceSpot", "BTCUSDT", depth=10)
print(f"\nBTCUSDT  last={book['lastPrice']}  bid={book['bestBid']}  ask={book['bestAsk']}")
print("top asks:", [f"{l['price']} x {l['baseQty']}" for l in book["asks"][:3]])
print("top bids:", [f"{l['price']} x {l['baseQty']}" for l in book["bids"][:3]])
