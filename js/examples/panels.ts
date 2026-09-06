// Slot control — drive the terminal's panels by a DURABLE slot id, at api-version 2.
// The id survives an instrument change, a clear, a KIND transition, and a terminal restart, so a
// tool can keep driving the same box forever ("condition met → show me that instrument"). A tab
// is ONE layout tree where a leaf IS the slot; what fills it is a union on `kind`.
// Run:  npx tsx examples/panels.ts
import { ColibriClient } from "../src/index.js";
import type { LayoutNode, SlotNode } from "../src/index.js";

const client = await ColibriClient.discover();

// GET /exchanges — the venue catalog: the exact strings every `exchange` param accepts.
const venues = await client.exchanges();
console.log("venues:", venues.map((e) => `${e.id}${e.trading ? "" : " (view-only)"}`).join(", "));

// GET /app/panels — the window → tab → layout tree. Scope with { tabId } / { windowIndex }.
function describe(content: SlotNode["content"]): string {
  switch (content.kind) {
    case "orderbook":
      return `${content.symbol} @ ${content.exchange}${content.viewOnly ? " (view-only)" : ""}`;
    case "chart":
      return `chart ${content.symbol} ${content.interval}`;
    case "widget":
      return `widget ${content.name}${content.installed ? "" : " (not installed)"}`;
    default:
      return "(empty)";
  }
}
function print(node: LayoutNode, indent = "  "): void {
  if (node.type === "split") {
    console.log(`${indent}${node.orientation}${node.share == null ? "" : ` ${node.share.toFixed(2)}`}`);
    for (const c of node.children) print(c, indent + "  ");
  } else {
    console.log(`${indent}slot ${node.id.slice(0, 8)}  ${describe(node.content)}${node.share == null ? "" : `  (${node.share.toFixed(2)})`}`);
  }
}
for (const w of await client.panels()) {
  for (const t of w.tabs) {
    console.log(`window ${w.index}${w.active ? " *" : ""} · tab ${t.index} "${t.title}" (${t.id})${t.active ? " *" : ""}:`);
    if (t.layout) print(t.layout);
  }
}

// POST /app/panels — add ONE box to the ACTIVE tab (pass tabId to target one — right-click a tab
// header in the terminal → "Copy tab ID"). content = a placeable content, `{kind, exchange, symbol}`.
const added = await client.addPanel({ content: { kind: "orderbook", exchange: "BinanceSpot", symbol: "BTCUSDT" } });
const slot = added.slot!;
console.log("\nadded:", slot.id, describe(slot.content));

// GET /app/panels/{id} — the slot plus WHERE it sits: its parent split, its index among its siblings.
const where = await client.panel(slot.id);
console.log("position:", where.position.path, where.position.parent ?? "(root slot)");

// PUT /app/panels/{id} — idempotent set. Change the instrument; the SLOT ID IS STABLE.
const changed = await client.setPanel(slot.id, { kind: "orderbook", exchange: "BinanceSpot", symbol: "ETHUSDT" });
console.log("changed:", describe(changed.slot!.content), "— id stable:", changed.slot!.id === slot.id);

// The box can even TRANSITION kind (orderbook → chart) — same id.
const chart = await client.setPanel(slot.id, { kind: "chart", exchange: "BinanceSpot", symbol: "ETHUSDT", interval: "M15" });
console.log("chart now:", describe(chart.slot!.content), "— id stable:", chart.slot!.id === slot.id);

// A STACK beside it: an orderbook with a chart under it, 70/30, as the box's own column.
const stack = await client.addPanels(
  [
    { kind: "orderbook", exchange: "BinanceSpot", symbol: "SOLUSDT", share: 0.7 },
    { kind: "chart", exchange: "BinanceSpot", symbol: "SOLUSDT", interval: "M5", share: 0.3 },
  ],
  { target: { slotId: slot.id, side: "right", action: "pair" }, orientation: "column" },
);
console.log("stack:", stack.slots!.map((s) => `${s.id.slice(0, 8)} ${describe(s.content)}`).join(" | "));

// PUT with no content — CLEAR the box. It stays on screen and KEEPS its id.
const cleared = await client.setPanel(slot.id);
console.log("cleared — box kept, id stable:", cleared.slot!.content.kind === "empty" && cleared.slot!.id === slot.id);

// DELETE /app/panels/{id} — remove the boxes entirely. A chart paired under an orderbook goes WITH
// the orderbook, so remove the stack chart-first (removing it second would 404 — it is already gone).
for (const s of [...stack.slots!].reverse()) await client.removePanel(s.id);
await client.removePanel(slot.id);
console.log("removed");
