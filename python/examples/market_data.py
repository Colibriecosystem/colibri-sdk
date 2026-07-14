"""Market data — symbols, book, clusters, funding.

    python examples/market_data.py
"""
from colibri import ColibriClient

client = ColibriClient.discover()
EXCHANGE, SYMBOL = "BinanceSpot", "BTCUSDT"

# GET /exchanges/{exchange}/symbols
symbols = client.symbols(EXCHANGE)
print(f"{EXCHANGE}: {len(symbols)} symbols. e.g.", [f"{s['symbol']} (tick {s['tickSize']})" for s in symbols[:3]])

# GET /markets/{exchange}/{symbol}/book  — dual-unit ladder, decimal strings
book = client.book(EXCHANGE, SYMBOL, depth=10)
print(f"\n{SYMBOL}  last={book['lastPrice']}  bid={book['bestBid']}  ask={book['bestAsk']}")
for a in reversed(book["asks"][:3]):
    print(f"  ask {a['price']}  {a['baseQty']}  (${a['usdVolume']})")
for b in book["bids"][:3]:
    print(f"  bid {b['price']}  {b['baseQty']}  (${b['usdVolume']})")

# GET /markets/{exchange}/{symbol}/clusters?limit=  — raw 1-minute buckets (merge timeframes yourself)
clusters = client.clusters(EXCHANGE, SYMBOL, limit=30)
print(f"\nclusters: {len(clusters['buckets'])} one-minute buckets")
if clusters["buckets"]:
    last = clusters["buckets"][-1]
    print(f"  latest bucket @{last['startUnixSec']}: buy ${last['totalBuyUsd']} / sell ${last['totalSellUsd']}")

# GET /markets/{exchange}/{symbol}/funding  — perps only
try:
    f = client.funding("BinanceLinearFutures", SYMBOL)
    print(f"\nfunding {f['symbol']}: rate={f['rate']}  nextMs={f['nextFundingTimeMs']}")
except Exception as exc:
    print("\nfunding: unavailable for this market", exc)
