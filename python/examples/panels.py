"""Slot control — drive the terminal's panels by a DURABLE slot id.

The id survives an instrument change, a clear, and a terminal restart, so a tool can keep
driving the same box forever ("condition met on my 3rd slot -> show me that instrument").

Run:  python examples/panels.py
"""

from colibri import ColibriClient

client = ColibriClient.discover()

# GET /app/panels — the window -> tab -> slot tree. Scope with tab_id= / window_index=.
for w in client.panels():
    for t in w["tabs"]:
        print(f"window {w['index']} · tab {t['index']} ({t['uuid']}):")
        for s in t["slots"]:
            body = "(empty)" if s["empty"] else f"{s['symbol']} @ {s['exchange']}"
            print(f"  slot {s['slotId']}  {body}" + (" + chart" if s.get("chart") else ""))

# POST /app/panels — add a panel to the ACTIVE tab (pass tab_id= to target one — right-click a
# tab header in the terminal -> "Copy tab ID"). content[0] is the orderbook.
added = client.add_panel([{"kind": "orderbook", "exchange": "BinanceSpot", "symbol": "BTCUSDT"}])
slot_id = added["panel"]["slotId"]
print("\nadded:", slot_id, added["panel"]["symbol"])

# PUT /app/panels/{id} — idempotent desired-state set. Change the instrument; the SLOT ID IS STABLE.
changed = client.set_panel(slot_id, [{"kind": "orderbook", "exchange": "BinanceSpot", "symbol": "ETHUSDT"}])
print("changed:", changed["panel"]["symbol"], "— id stable:", changed["panel"]["slotId"] == slot_id)

# PUT with content=[] — CLEAR the panel. The box stays on screen and KEEPS its id.
cleared = client.set_panel(slot_id, [])
print("cleared — box kept, id stable:", cleared["panel"]["empty"] and cleared["panel"]["slotId"] == slot_id)

# DELETE /app/panels/{id} — remove the slot entirely (a paired chart would go with it).
client.remove_panel(slot_id)
print("removed", slot_id)
