// The workspace surface — windows, tabs, the boxes docked in a tab, and the chart windows that
// float beside them — plus the closed-trade history. Supersedes `panels.ts` (`/app/panels` is
// deprecated); this surface carries no `api-version`, because every route in it is new.
//
// Everything created here is torn down at the end, so it is safe to run against a live terminal.
// Run:  npx tsx examples/workspace.ts
import { ColibriClient } from "../src/index.js";
import type { ChartWindow, LayoutNode, SlotNode } from "../src/index.js";

const exchange = "BinanceSpot";
const client = await ColibriClient.discover();

// ── read ──────────────────────────────────────────────────────────────────
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
function print(node: LayoutNode, indent = "      "): void {
  if (node.type === "split") {
    console.log(`${indent}${node.orientation}`);
    for (const c of node.children) print(c, indent + "  ");
  } else {
    console.log(`${indent}slot ${node.id.slice(0, 8)}  ${describe(node.content)}`);
  }
}
function line(w: ChartWindow): string {
  const tf = w.kind === "comboChart" ? w.intervals.join("/") : w.interval;
  return `${w.kind} ${w.symbol} ${tf}${w.pinned ? " pinned" : ""}${w.locked ? " locked" : ""}`;
}

// GET /app/windows — the cheap read: no tab payload, just `tabCount`.
for (const w of await client.listWindows()) {
  console.log(`window ${w.index} ${w.kind}${w.active ? " *" : ""}  ${w.tabCount} tab(s)  ${w.bounds.width}x${w.bounds.height}`);
}

// GET /app/workspace — the whole document: windows → tabs → layout + floating chart windows.
for (const w of await client.getWorkspace()) {
  for (const t of w.tabs) {
    console.log(`\nwindow ${w.index} · tab ${t.index} "${t.title}" (${t.id})${t.active ? " *" : ""}`);
    if (t.layout) print(t.layout);
    for (const cw of t.windows) console.log(`      ↗ ${line(cw)}`);
  }
}

// ── build a tab, fill it, take it apart ───────────────────────────────────
// POST /app/tabs → 201. No layout yet — it is an empty tab until something is added.
const made = await client.createTab({ title: "SDK demo" });
const tabId = made.tab.id;
console.log(`\ncreated tab ${tabId} at index ${made.tab.index} of window ${made.position.windowId}`);

// POST /app/slots → 201. An ordered stack: an orderbook with its chart under it, 70/30. `share`
// sits on the SLOT, not inside the content — one written inside a content is silently dropped.
//
// `target` is omitted, which the contract defines as `{ edge: "right" }`. Say that explicitly and
// terminal 1.0.0 answers 404 `unknown_slot` — the edge half of the union is refused on every value
// there, so the default is reachable only by leaving the field out. `{ slot, side }` works, and is
// what you want anyway once there is a box to anchor to.
const added = await client.addSlots({
  tabId,
  stack: "column",
  slots: [
    { share: 0.7, content: { kind: "orderbook", exchange, symbol: "BTCUSDT" } },
    { share: 0.3, content: { kind: "chart", exchange, symbol: "BTCUSDT", interval: "M5" } },
  ],
});
console.log(`added: ${added.slots.map((s) => `${s.id.slice(0, 8)} ${describe(s.content)}`).join(" | ")}`);

// GET /app/slots/{id} — where the box sits: durable window + tab ids, the index chain, its parent.
const book = added.slots[0];
const where = await client.getSlot(book.id);
console.log(`position: tab ${where.position.tabId} path [${where.position.path}] parent ${JSON.stringify(where.position.parent ?? "(root)")}`);

// DELETE /app/slots/{id} — structural: the box is gone and its id retired. Do the paired chart
// NOW, while it is still its own box: it is docked under the orderbook, so it goes WITH it the
// moment that box changes kind or is cleared, and a later remove would 404 on something already
// gone.
await client.removeSlot(added.slots[1].id);
console.log("removed the paired chart — the orderbook is alone in the tab now");

// PUT /app/slots/{id} — idempotent set. The instrument changes; the SLOT ID DOES NOT.
const changed = await client.setSlot(book.id, { kind: "orderbook", exchange, symbol: "ETHUSDT" });
console.log(`set: ${describe(changed.slot.content)} — id stable: ${changed.slot.id === book.id}`);

// The box can even transition KIND — still the same id.
const asChart = await client.setSlot(book.id, { kind: "chart", exchange, symbol: "ETHUSDT", interval: "M15" });
console.log(`kind transition: ${describe(asChart.slot.content)} — id stable: ${asChart.slot.id === book.id}`);

// Clearing keeps the box and its id. `content` is required on a set, so this has its own method.
const cleared = await client.clearSlot(book.id);
console.log(`cleared: ${describe(cleared.slot.content)} — box kept: ${cleared.slot.id === book.id}`);

// ── tabs: the tri-state title ─────────────────────────────────────────────
// A string renames. Then reorder ALONE — and the name survives, because the key is absent.
await client.updateTab(tabId, { title: "Scalp" });
await client.updateTab(tabId, { index: 0 });
console.log(`\nrenamed then reordered — title is still "${(await client.getTab(tabId)).tab.title}"`);

// `null` is the CLEAR. It restores the automatic coin + count label.
await client.updateTab(tabId, { title: null });
console.log(`cleared the name — the terminal computes "${(await client.getTab(tabId)).tab.title}"`);

// ── chart windows ─────────────────────────────────────────────────────────
// POST /app/chart-windows answers 200 OR 201: 200 means that (kind, exchange, symbol) was already
// open and the live window was re-homed, which is a success, not an error.
const opened = await client.openChartWindow({ kind: "chart", exchange, symbol: "SOLUSDT", interval: "M5", tabId });
console.log(`\nchart window ${opened.status}: ${line(opened.chartWindow)}`);

const patched = await client.updateChartWindow(opened.chartWindow.id, { interval: "H1", pinned: false });
console.log(`patched: ${line(patched.chartWindow)}`);
console.log(`this tab owns ${(await client.listChartWindows({ tabId })).length} chart window(s)`);

// ── tear down ─────────────────────────────────────────────────────────────
await client.closeChartWindow(opened.chartWindow.id);
// Closing the tab takes whatever it still holds — the cleared box here — with it.
await client.closeTab(tabId);
console.log("\ntorn down");

// ── closed trades (read-only) ─────────────────────────────────────────────
// Every money and size field is a decimal STRING — parse at the edge, never store the float.
const [connection] = await client.connections();
if (connection) {
  const page = await client.listTrades(connection.id, { pageSize: 5 });
  console.log(`\n${connection.id}: ${page.totalCount} closed trade(s), page ${page.page}/${page.totalPages}`);
  for (const t of page.trades) {
    console.log(`  #${t.id} ${t.side} ${t.symbol}  ${t.openPrice} → ${t.closePrice}  net ${t.netPnl} (${t.pnlPercent}%)`);
  }

  // GET one trade WITH its individual venue fills, oldest first.
  const first = page.trades[0];
  if (first) {
    const detail = await client.getTrade(connection.id, first.id);
    console.log(`  #${first.id} is ${detail.fills.length} fill(s):`);
    for (const f of detail.fills) console.log(`    ${f.isBuyer ? "buy " : "sell"} ${f.quantity} @ ${f.price}  fee ${f.commission}`);
  }
}
