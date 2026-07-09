// Streaming — every WebSocket channel on /stream.
// Run:  npx tsx examples/stream-all.ts
import { ColibriClient } from "../src/index.js";

const client = await ColibriClient.discover();
const [EXCHANGE, SYMBOL] = ["BinanceSpot", "BTCUSDT"];

// Need a connectionId for the account channels (positions/orders/balance).
const conn = (await client.connections())[0];

const ws = client.stream();

// Market channels — keyed by exchange + symbol.
ws.on("book", (d) => console.log("[book]", (d as { bestBid: string; bestAsk: string }).bestBid, "/", (d as { bestAsk: string }).bestAsk));
ws.on("trades", (d) => console.log("[trades]", (d as { trades: unknown[] }).trades.length, "prints"));
ws.on("funding", (d) => console.log("[funding]", d));

// Account channels — keyed by connectionId.
ws.on("positions", (d) => console.log("[positions]", d));
ws.on("orders", (d) => console.log("[orders]", d));
ws.on("balance", (d) => console.log("[balance]", d));

// App-wide channels — no key.
ws.on("notifications", (d) => console.log("[notification]", d));
ws.on("signalLevels", (d, f) => console.log("[signalLevel]", f.event, d));

ws.on("error", (e) => console.error("[error]", e));

await ws.connect();

ws.subscribe("book", { exchange: EXCHANGE, symbol: SYMBOL, hz: 2, depth: 20 });
ws.subscribe("trades", { exchange: EXCHANGE, symbol: SYMBOL });
ws.subscribe("funding", { exchange: "BinanceLinearFutures", symbol: SYMBOL });
ws.subscribe("notifications");
ws.subscribe("signalLevels");
if (conn) {
  ws.subscribe("positions", { connectionId: conn.id });
  ws.subscribe("orders", { connectionId: conn.id });
  ws.subscribe("balance", { connectionId: conn.id });
}

console.log("subscribed to all channels — Ctrl+C to stop");
