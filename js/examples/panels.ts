// Slot control — drive the terminal's panels by a DURABLE slot id.
// The id survives an instrument change, a clear, a VIEW/kind transition, and a terminal restart,
// so a tool can keep driving the same box forever ("condition met → show me that instrument").
// Run:  npx tsx examples/panels.ts
import { ColibriClient } from "../src/index.js";

const client = await ColibriClient.discover();

// GET /exchanges — the venue catalog: the exact strings every `exchange` param accepts.
const venues = await client.exchanges();
console.log("venues:", venues.map((e) => `${e.id}${e.trading ? "" : " (view-only)"}`).join(", "));

// GET /app/panels — the window → tab → slot tree. Scope with { tabId } / { windowIndex }.
for (const w of await client.panels()) {
  for (const t of w.tabs) {
    console.log(`window ${w.index} · tab ${t.index} (${t.uuid}):`);
    for (const s of t.slots) {
      console.log(`  slot ${s.slotId}  ${s.empty ? "(empty)" : `${s.symbol} @ ${s.exchange} [${s.kind}]`}${s.chart ? " + chart" : ""}`);
    }
  }
}

// POST /app/panels — add a panel to the ACTIVE tab (pass tabId to target one — right-click a tab
// header in the terminal → "Copy tab ID"). content = ONE instrument + the views that render it.
const added = await client.addPanel({
  content: { exchange: "BinanceSpot", symbol: "BTCUSDT", views: ["orderbook"] },
});
const slotId = added.panel!.slotId;
console.log("\nadded:", slotId, added.panel!.symbol);

// PUT /app/panels/{id} — idempotent desired-state set. Change the instrument AND pair a chart in
// one call; the SLOT ID IS STABLE.
const changed = await client.setPanel(slotId, {
  exchange: "BinanceSpot",
  symbol: "ETHUSDT",
  views: ["orderbook", "chart"],
});
console.log("changed:", changed.panel!.symbol, "+chart — id stable:", changed.panel!.slotId === slotId);

// Views are part of the desired state — the box can even TRANSITION kind (orderbook → chart-only).
const chartOnly = await client.setPanel(slotId, {
  exchange: "BinanceSpot",
  symbol: "ETHUSDT",
  views: ["chart"],
});
console.log("chart-only now — id stable:", chartOnly.panel!.slotId === slotId);

// PUT with no content — CLEAR the panel. The box stays on screen and KEEPS its id.
const cleared = await client.setPanel(slotId);
console.log("cleared — box kept, id stable:", cleared.panel!.empty && cleared.panel!.slotId === slotId);

// DELETE /app/panels/{id} — remove the slot entirely (a paired chart would go with it).
await client.removePanel(slotId);
console.log("removed", slotId);
