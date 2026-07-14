// App bridge + notifications + signal levels — drive the terminal UI from a widget.
// Run:  npx tsx examples/app-and-signals.ts
import { ColibriClient } from "../src/index.js";

const client = await ColibriClient.discover();
const [EXCHANGE, SYMBOL] = ["BinanceSpot", "BTCUSDT"];

// openSymbol — open ONE coin + surface the window ("see the move → open the book").
// A POST /app/panels {activate:true} under the hood — returns the created slot.
console.log("open-symbol:", await client.openSymbol(EXCHANGE, SYMBOL));

// POST /app/combos  — fan the coin across every connection that lists it
console.log("combo:", await client.openCombo(SYMBOL, "window"));

// POST /notifications  — raise a toast in the terminal
console.log("notify:", await client.notify("Hello from a widget 👋", "info", "my-widget"));

// POST /signals  — post a free-text market signal into Notifications → API tab
console.log("signal:", await client.signal(EXCHANGE, SYMBOL, "whale wall pulled"));

// Signal levels — API-owned price alerts, ALSO drawn on the ladder.
const last = Number((await client.book(EXCHANGE, SYMBOL)).lastPrice);

// POST /signal-levels  → 201. A level fires AT MOST ONCE: oneShot removes it on fire, otherwise
// it is kept marked isTriggered (sweep those with deleteTriggeredSignalLevels()).
const level = await client.createSignalLevel({
  exchange: EXCHANGE,
  symbol: SYMBOL,
  price: (last * 1.02).toFixed(2), // fire when price crosses +2%
  direction: "above",
  note: "breakout watch",
  oneShot: true,
});
console.log("\ncreated level:", level.id, "@", level.price, "triggered:", level.isTriggered);

// GET /signal-levels?exchange=&symbol=  (a connectionId filter is available too)
console.log("levels now:", (await client.signalLevels(EXCHANGE, SYMBOL)).map((l) => `${l.price} (${l.direction})`));

// DELETE /signal-levels/{id}
console.log("deleted:", await client.deleteSignalLevel(level.id));

// DELETE /signal-levels/triggered  — sweep every already-fired level
console.log("swept fired levels:", await client.deleteTriggeredSignalLevels());
