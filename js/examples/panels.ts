// Slot control — drive the terminal's panels by a DURABLE slot id.
// The id survives an instrument change, a clear, and a terminal restart, so a tool can keep
// driving the same box forever ("condition met on my 3rd slot → show me that instrument").
// Run:  npx tsx examples/panels.ts
import { ColibriClient } from "../src/index.js";

const client = await ColibriClient.discover();

// GET /app/panels — the window → tab → slot tree. Scope with { tabId } / { windowIndex }.
const windows = await client.panels();
for (const w of windows) {
  for (const t of w.tabs) {
    console.log(`window ${w.index} · tab ${t.index} (${t.uuid}):`);
    for (const s of t.slots) {
      console.log(`  slot ${s.slotId}  ${s.empty ? "(empty)" : `${s.symbol} @ ${s.exchange}`}${s.chart ? " + chart" : ""}`);
    }
  }
}

// POST /app/panels — add a panel to the ACTIVE tab (pass tabId to target one — right-click a
// tab header in the terminal → "Copy tab ID"). content[0] is the orderbook.
const added = await client.addPanel({
  content: [{ kind: "orderbook", exchange: "BinanceSpot", symbol: "BTCUSDT" }],
});
const slotId = added.panel!.slotId;
console.log("\nadded:", slotId, added.panel!.symbol);

// PUT /app/panels/{id} — idempotent desired-state set. Change the instrument; the SLOT ID IS STABLE.
const changed = await client.setPanel(slotId, {
  content: [{ kind: "orderbook", exchange: "BinanceSpot", symbol: "ETHUSDT" }],
});
console.log("changed:", changed.panel!.symbol, "— id stable:", changed.panel!.slotId === slotId);

// PUT with content: [] — CLEAR the panel. The box stays on screen and KEEPS its id, so a later
// set on the same id fills the same box.
const cleared = await client.setPanel(slotId, { content: [] });
console.log("cleared — box kept, id stable:", cleared.panel!.empty && cleared.panel!.slotId === slotId);

// DELETE /app/panels/{id} — remove the slot entirely (a paired chart would go with it).
await client.removePanel(slotId);
console.log("removed", slotId);
