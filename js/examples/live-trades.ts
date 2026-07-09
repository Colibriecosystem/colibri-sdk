// Live trades: subscribe to the `trades` channel (incremental — one message per new print).
// Run:  node --experimental-strip-types examples/live-trades.ts
import { ColibriClient, type TradePush } from "../src/index.js";

const client = await ColibriClient.discover();
const ws = client.stream();

ws.on("trades", (data) => {
  const p = data as { trades: TradePush[] };
  for (const t of p.trades) {
    const side = t.isBuy ? "BUY " : "SELL";
    console.log(`${side}  ${t.qty} @ ${t.price}`);
  }
});

await ws.connect();
ws.subscribe("trades", { exchange: "BinanceSpot", symbol: "BTCUSDT" });

console.log("streaming BTCUSDT trades — Ctrl+C to stop");
