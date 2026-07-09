"""Market data — symbols, book, clusters, funding.

    python examples/market_data.py
"""
from colibri import ColibriClient

client = ColibriClient.discover()
EXCHANGE, SYMBOL = "BinanceSpot", "BTCUSDT"

# GET /symbols?exchange=
symbols = client.symbols(EXCHANGE)
print(f"{EXCHANGE}: {len(symbols)} symbols. e.g.", [f"{s['symbol']} (tick {s['tickSize']})" for s in symbols[:3]])

# GET /book/{exchange}/{symbol}  — dual-unit ladder, decimal strings
book = client.book(EXCHANGE, SYMBOL, depth=10, aggregation=1)
print(f"\n{SYMBOL}  last={book['lastPrice']}  bid={book['bestBid']}  ask={book['bestAsk']}")
for a in reversed(book["asks"][:3]):
    print(f"  ask {a['price']}  {a['baseQty']}  (${a['usdVolume']})")
for b in book["bids"][:3]:
    print(f"  bid {b['price']}  {b['baseQty']}  (${b['usdVolume']})")

# GET /clusters/{exchange}/{symbol}?timeframe=
clusters = client.clusters(EXCHANGE, SYMBOL, timeframe="5m")
print(f"\nclusters: {len(clusters['buckets'])} buckets on 5m")

# GET /funding/{exchange}/{symbol}  — perps only
try:
    f = client.funding("BinanceLinearFutures", SYMBOL)
    print(f"\nfunding {f['symbol']}: rate={f['rate']}  nextMs={f['nextFundingTimeMs']}")
except Exception as exc:
    print("\nfunding: unavailable for this market", exc)
