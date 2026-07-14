// Market data — symbols, book, clusters, funding.
// Run:  npx tsx examples/market-data.ts
import { ColibriClient } from "../src/index.js";

const client = await ColibriClient.discover();
const [EXCHANGE, SYMBOL] = ["BinanceSpot", "BTCUSDT"];

// GET /exchanges/{exchange}/symbols  — the tradeable universe + metadata
const symbols = await client.symbols(EXCHANGE);
console.log(`${EXCHANGE}: ${symbols.length} symbols. e.g.`, symbols.slice(0, 3).map((s) => `${s.symbol} (tick ${s.tickSize})`));

// GET /markets/{exchange}/{symbol}/book  — dual-unit ladder (baseQty + usdVolume), decimal strings
const book = await client.book(EXCHANGE, SYMBOL, { depth: 10 });
console.log(`\n${SYMBOL}  last=${book.lastPrice}  bid=${book.bestBid}  ask=${book.bestAsk}`);
for (const a of book.asks.slice(0, 3).reverse()) console.log(`  ask ${a.price}  ${a.baseQty}  ($${a.usdVolume})`);
for (const b of book.bids.slice(0, 3)) console.log(`  bid ${b.price}  ${b.baseQty}  ($${b.usdVolume})`);

// GET /markets/{exchange}/{symbol}/clusters?limit=  — raw 1-minute buckets (merge timeframes yourself)
const clusters = await client.clusters(EXCHANGE, SYMBOL, 30);
console.log(`\nclusters: ${clusters.buckets.length} one-minute buckets`);
const last = clusters.buckets.at(-1);
if (last) console.log(`  latest bucket @${new Date(last.startUnixSec * 1000).toISOString()}: buy $${last.totalBuyUsd} / sell $${last.totalSellUsd}`);

// GET /markets/{exchange}/{symbol}/funding  — perp funding (spot venues answer 404 unavailable)
try {
  const f = await client.funding("BinanceLinearFutures", SYMBOL);
  console.log(`\nfunding ${f.symbol}: rate=${f.rate}  next=${new Date(f.nextFundingTimeMs).toISOString()}`);
} catch (e) {
  console.log("\nfunding: unavailable for this market", (e as Error).message);
}
