"""Slot control — drive the terminal's panels by a DURABLE slot id, at api-version 2.

The id survives an instrument change, a clear, a kind transition, and a terminal restart, so a
tool can keep driving the same box forever ("condition met -> show me that instrument"). A tab is
ONE layout tree where a leaf IS the slot; what fills it is a union on "kind".

Run:  python examples/panels.py
"""

from colibri import ColibriClient

client = ColibriClient.discover()

# GET /exchanges — the venue catalog: the exact strings every exchange param accepts.
venues = client.exchanges()
print("venues:", ", ".join(e["id"] + ("" if e["trading"] else " (view-only)") for e in venues))


def describe(content: dict) -> str:
    kind = content["kind"]
    if kind == "orderbook":
        return f"{content['symbol']} @ {content['exchange']}" + (" (view-only)" if content["viewOnly"] else "")
    if kind == "chart":
        return f"chart {content['symbol']} {content['interval']}"
    if kind == "widget":
        return f"widget {content['name']}" + ("" if content["installed"] else " (not installed)")
    return "(empty)"


def show(node: dict, indent: str = "  ") -> None:
    share = "" if node.get("share") is None else f" {node['share']:.2f}"
    if node["type"] == "split":
        print(f"{indent}{node['orientation']}{share}")
        for child in node["children"]:
            show(child, indent + "  ")
    else:
        print(f"{indent}slot {node['id'][:8]}  {describe(node['content'])}{share}")


# GET /app/panels — the window -> tab -> layout tree. Scope with tab_id= / window_index=.
for w in client.panels():
    for t in w["tabs"]:
        print(f"window {w['index']}{' *' if w['active'] else ''} · tab {t['index']} \"{t['title']}\" ({t['id']}){' *' if t['active'] else ''}:")
        if t["layout"]:
            show(t["layout"])

# POST /app/panels — add ONE box to the ACTIVE tab (pass tab_id= to target one — right-click a
# tab header in the terminal -> "Copy tab ID"). content = a placeable content, {kind, exchange, symbol}.
added = client.add_panel({"kind": "orderbook", "exchange": "BinanceSpot", "symbol": "BTCUSDT"})
slot_id = added["slot"]["id"]
print("\nadded:", slot_id, describe(added["slot"]["content"]))

# GET /app/panels/{id} — the slot plus WHERE it sits: its parent split, its index among its siblings.
where = client.panel(slot_id)
print("position:", where["position"]["path"], where["position"].get("parent", "(root slot)"))

# PUT /app/panels/{id} — idempotent set. Change the instrument; the SLOT ID IS STABLE.
changed = client.set_panel(slot_id, {"kind": "orderbook", "exchange": "BinanceSpot", "symbol": "ETHUSDT"})
print("changed:", describe(changed["slot"]["content"]), "— id stable:", changed["slot"]["id"] == slot_id)

# The box can even TRANSITION kind (orderbook -> chart) — same id.
chart = client.set_panel(slot_id, {"kind": "chart", "exchange": "BinanceSpot", "symbol": "ETHUSDT", "interval": "M15"})
print("chart now:", describe(chart["slot"]["content"]), "— id stable:", chart["slot"]["id"] == slot_id)

# A STACK beside it: an orderbook with a chart under it, 70/30, as the box's own column.
stack = client.add_panels(
    [
        {"kind": "orderbook", "exchange": "BinanceSpot", "symbol": "SOLUSDT", "share": 0.7},
        {"kind": "chart", "exchange": "BinanceSpot", "symbol": "SOLUSDT", "interval": "M5", "share": 0.3},
    ],
    target={"slotId": slot_id, "side": "right", "action": "pair"},
    orientation="column",
)
print("stack:", " | ".join(f"{s['id'][:8]} {describe(s['content'])}" for s in stack["slots"]))

# PUT with no content — CLEAR the box. It stays on screen and KEEPS its id.
cleared = client.set_panel(slot_id)
print("cleared — box kept, id stable:", cleared["slot"]["content"]["kind"] == "empty" and cleared["slot"]["id"] == slot_id)

# DELETE /app/panels/{id} — remove the boxes entirely. A chart paired under an orderbook goes WITH
# the orderbook, so remove the stack chart-first (removing it second would 404 — it is already gone).
for s in reversed(stack["slots"]):
    client.remove_panel(s["id"])
client.remove_panel(slot_id)
print("removed")
