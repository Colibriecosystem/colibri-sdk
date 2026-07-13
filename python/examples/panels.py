"""Slot control — drive the terminal's panels by a DURABLE slot id.

The id survives an instrument change, a clear, a view/kind transition, and a terminal restart,
so a tool can keep driving the same box forever ("condition met -> show me that instrument").

Run:  python examples/panels.py
"""

from colibri import ColibriClient

client = ColibriClient.discover()

# GET /exchanges — the venue catalog: the exact strings every exchange param accepts.
venues = client.exchanges()
print("venues:", ", ".join(e["id"] + ("" if e["trading"] else " (view-only)") for e in venues))

# GET /app/panels — the window -> tab -> slot tree. Scope with tab_id= / window_index=.
for w in client.panels():
    for t in w["tabs"]:
        print(f"window {w['index']} · tab {t['index']} ({t['uuid']}):")
        for s in t["slots"]:
            body = "(empty)" if s["empty"] else f"{s['symbol']} @ {s['exchange']} [{s['kind']}]"
            print(f"  slot {s['slotId']}  {body}" + (" + chart" if s.get("chart") else ""))

# POST /app/panels — add a panel to the ACTIVE tab (pass tab_id= to target one — right-click a
# tab header in the terminal -> "Copy tab ID"). content = ONE instrument + the views rendering it.
added = client.add_panel({"exchange": "BinanceSpot", "symbol": "BTCUSDT", "views": ["orderbook"]})
slot_id = added["panel"]["slotId"]
print("\nadded:", slot_id, added["panel"]["symbol"])

# PUT /app/panels/{id} — idempotent desired-state set. Change the instrument AND pair a chart in
# one call; the SLOT ID IS STABLE.
changed = client.set_panel(slot_id, {"exchange": "BinanceSpot", "symbol": "ETHUSDT", "views": ["orderbook", "chart"]})
print("changed:", changed["panel"]["symbol"], "+chart — id stable:", changed["panel"]["slotId"] == slot_id)

# Views are part of the desired state — the box can even TRANSITION kind (orderbook -> chart-only).
chart_only = client.set_panel(slot_id, {"exchange": "BinanceSpot", "symbol": "ETHUSDT", "views": ["chart"]})
print("chart-only now — id stable:", chart_only["panel"]["slotId"] == slot_id)

# PUT with no content — CLEAR the panel. The box stays on screen and KEEPS its id.
cleared = client.set_panel(slot_id)
print("cleared — box kept, id stable:", cleared["panel"]["empty"] and cleared["panel"]["slotId"] == slot_id)

# DELETE /app/panels/{id} — remove the slot entirely (a paired chart would go with it).
client.remove_panel(slot_id)
print("removed", slot_id)
