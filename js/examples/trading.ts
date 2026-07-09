// Trading — place, cancel, cancel-all, panic. GRANT-GATED (Settings → Program → Local API).
//
// SAFETY: this example places a REAL order. It is a no-op UNLESS you arm it:
//   COLIBRI_ARM=1 npx tsx examples/trading.ts
// It uses a far-from-market LIMIT so it rests without filling; adjust the price/size for your symbol.
import { ColibriClient } from "../src/index.js";

const ARMED = process.env.COLIBRI_ARM === "1";
const client = await ColibriClient.discover();
const [EXCHANGE, SYMBOL] = ["BinanceSpot", "BTCUSDT"];

// Pick the first trading-enabled connection (needs the per-connection grant).
const conn = (await client.connections()).find((c) => c.apiTradingEnabled);
if (!conn) {
  console.log("no trading-granted connection — enable a grant in Settings → Program → Local API");
  process.exit(0);
}

const book = await client.book(EXCHANGE, SYMBOL);
const restPrice = (Number(book.bestBid) * 0.5).toFixed(2); // 50% below market → will not fill

if (!ARMED) {
  console.log("DRY RUN (set COLIBRI_ARM=1 to actually trade). Would place:");
  console.log({ connectionId: conn.id, exchange: EXCHANGE, symbol: SYMBOL, side: "BUY", type: "LIMIT", price: restPrice, sizeQuote: "10" });
  process.exit(0);
}

// POST /orders  → 202 { clientOrderId, status } ; lifecycle then arrives on the WS `orders` channel.
const placed = await client.placeOrder({
  connectionId: conn.id,
  exchange: EXCHANGE,
  symbol: SYMBOL,
  side: "BUY",
  type: "LIMIT",
  price: restPrice,
  sizeQuote: "10", // spend $10 (use sizeBase for a coin amount instead)
});
console.log("placed:", placed);

// DELETE /orders/{clientOrderId}?connectionId=
await client.cancelOrder(placed.clientOrderId, conn.id);
console.log("cancelled", placed.clientOrderId);

// POST /orders/cancelAll  — every working order for this symbol
await client.cancelAll(conn.id, EXCHANGE, SYMBOL);
console.log("cancel-all done");

// POST /panic/cancel-all-orders  — the global Del key (omit id → every granted account)
console.log("panic cancel-all-orders:", await client.panicCancelAllOrders(conn.id));

// POST /panic/close-all-positions — the NumPad0 super-panic (flatten + cancel)
// console.log(await client.panicCloseAllPositions(conn.id));
