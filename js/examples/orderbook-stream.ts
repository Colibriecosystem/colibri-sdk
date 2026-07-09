// Live order book: subscribe to the `book` channel and print the spread on every frame.
// Run:  node --experimental-strip-types examples/orderbook-stream.ts
import { ColibriClient, type Book } from "../src/index.js";

const client = await ColibriClient.discover();
const ws = client.stream();

ws.on("book", (data) => {
  const b = data as Book;
  console.log(`${b.symbol}  bid ${b.bestBid}  |  ask ${b.bestAsk}  (${b.bids.length}×${b.asks.length} levels)`);
});
ws.on("error", (e) => console.error("stream error:", e));

await ws.connect();
ws.subscribe("book", { exchange: "BinanceSpot", symbol: "BTCUSDT", hz: 5, depth: 20 });

console.log("streaming BTCUSDT book — Ctrl+C to stop");
