// App bridge + notifications + signal levels — drive the terminal UI from a widget.
// Run:  npx tsx examples/app-and-signals.ts
import { ColibriClient } from "../src/index.js";

const client = await ColibriClient.discover();
const [EXCHANGE, SYMBOL] = ["BinanceSpot", "BTCUSDT"];

// POST /app/open-symbol  — open ONE coin on its venue ("see the move → open the book")
console.log("open-symbol:", await client.openSymbol(EXCHANGE, SYMBOL));

// POST /app/open-combo  — fan the coin across every connection that lists it
console.log("open-combo:", await client.openCombo(SYMBOL, "window"));

// POST /notifications  — raise a toast in the terminal
console.log("notify:", await client.notify("Hello from a widget 👋", "info", "my-widget"));

// POST /signals  — post a free-text market signal into Notifications → API tab
console.log("signal:", await client.signal(EXCHANGE, SYMBOL, "whale wall pulled"));

// Signal levels — API-owned price alerts, ALSO drawn on the ladder.
const last = Number((await client.book(EXCHANGE, SYMBOL)).lastPrice);

// POST /signal-levels  → 201
const level = await client.createSignalLevel({
  exchange: EXCHANGE,
  symbol: SYMBOL,
  price: (last * 1.02).toFixed(2), // fire when price crosses +2%
  direction: "above",
  note: "breakout watch",
  oneShot: true,
});
console.log("\ncreated level:", level.id, "@", level.price);

// GET /signal-levels?exchange=&symbol=
console.log("levels now:", (await client.signalLevels(EXCHANGE, SYMBOL)).map((l) => `${l.price} (${l.direction})`));

// DELETE /signal-levels/{id}
await client.deleteSignalLevel(level.id);
console.log("deleted", level.id);
