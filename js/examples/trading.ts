// Trading — place, cancel, bulk cancel, emergency sweeps. GRANT-GATED (Settings → Program → Local API).
//
// SAFETY: this example places a REAL order. It is a no-op UNLESS you arm it:
//   COLIBRI_ARM=1 npx tsx examples/trading.ts
// It uses a far-from-market LIMIT so it rests without filling; adjust the price/size for your symbol.
import { ColibriClient } from "../src/index.js";

const ARMED = process.env.COLIBRI_ARM === "1";
const client = await ColibriClient.discover();
const [EXCHANGE, SYMBOL] = ["BinanceSpot", "BTCUSDT"];

// Pick the first trading-enabled connection (needs the per-connection grant).
// The venue derives from the connection — the order body carries neither connectionId nor exchange.
const conn = (await client.connections()).find((c) => c.apiTradingEnabled && c.exchange === EXCHANGE);
if (!conn) {
  console.log(`no trading-granted ${EXCHANGE} connection — enable a grant in Settings → Program → Local API`);
  process.exit(0);
}

const book = await client.book(EXCHANGE, SYMBOL);
const restPrice = (Number(book.bestBid) * 0.5).toFixed(2); // 50% below market → will not fill

if (!ARMED) {
  console.log("DRY RUN (set COLIBRI_ARM=1 to actually trade). Would place on", conn.id, ":");
  console.log({ symbol: SYMBOL, side: "BUY", type: "Limit", price: restPrice, sizeQuote: "10" });
  process.exit(0);
}

// POST /connections/{id}/orders  → 202 { clientOrderId, status } ; lifecycle then arrives on the WS `orders` channel.
const placed = await client.placeOrder(conn.id, {
  symbol: SYMBOL,
  side: "BUY",
  type: "Limit",
  price: restPrice,
  sizeQuote: "10", // spend $10 (use sizeBase for a coin amount instead)
});
console.log("placed:", placed);

// DELETE /connections/{id}/orders/{clientOrderId}?symbol=
await client.cancelOrder(conn.id, placed.clientOrderId, SYMBOL);
console.log("cancelled", placed.clientOrderId);

// DELETE /connections/{id}/orders?symbol=  — every working order for this symbol
await client.cancelAll(conn.id, SYMBOL);
console.log("cancel-all (symbol) done");

// DELETE /connections/{id}/orders  — every order on the whole account (positions untouched)
// await client.cancelAll(conn.id);

// DELETE /connections/{id}/positions — close every position + cancel leftovers on this account
// await client.closePositions(conn.id);

// Emergency sweeps — EVERY granted account, one call (the terminal's global hotkey scopes):
console.log("sweep cancel-all-orders:", await client.cancelAllOrders()); // DELETE /orders
// console.log("sweep close-all-positions:", await client.closeAllPositions()); // DELETE /positions
