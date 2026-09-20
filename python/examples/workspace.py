"""The workspace surface — windows, tabs, the boxes docked in a tab, and the chart windows that
float beside them — plus the closed-trade history. Supersedes panels.py (/app/panels is
deprecated); this surface carries no api-version, because every route in it is new.

Everything created here is torn down at the end, so it is safe to run against a live terminal.
Run:  python examples/workspace.py
"""
from colibri import ColibriClient

EXCHANGE = "BinanceSpot"
client = ColibriClient.discover()


# ── read ─────────────────────────────────────────────────────────────────────
def describe(content: dict) -> str:
    kind = content["kind"]
    if kind == "orderbook":
        return f"{content['symbol']} @ {content['exchange']}" + (" (view-only)" if content["viewOnly"] else "")
    if kind == "chart":
        return f"chart {content['symbol']} {content['interval']}"
    if kind == "widget":
        return f"widget {content['name']}" + ("" if content["installed"] else " (not installed)")
    return "(empty)"


def show(node: dict, indent: str = "      ") -> None:
    if node["type"] == "split":
        print(f"{indent}{node['orientation']}")
        for child in node["children"]:
            show(child, indent + "  ")
    else:
        print(f"{indent}slot {node['id'][:8]}  {describe(node['content'])}")


def line(w: dict) -> str:
    tf = "/".join(w["intervals"]) if w["kind"] == "comboChart" else w["interval"]
    return f"{w['kind']} {w['symbol']} {tf}" + (" pinned" if w["pinned"] else "") + (" locked" if w["locked"] else "")


# GET /app/windows — the cheap read: no tab payload, just "tabCount".
for w in client.list_windows():
    b = w["bounds"]
    print(f"window {w['index']} {w['kind']}{' *' if w['active'] else ''}  {w['tabCount']} tab(s)  {b['width']}x{b['height']}")

# GET /app/workspace — the whole document: windows -> tabs -> layout + floating chart windows.
for w in client.get_workspace():
    for t in w["tabs"]:
        print(f"\nwindow {w['index']} · tab {t['index']} \"{t['title']}\" ({t['id']}){' *' if t['active'] else ''}")
        if t.get("layout"):
            show(t["layout"])
        for cw in t["windows"]:
            print(f"      ↗ {line(cw)}")

# ── build a tab, fill it, take it apart ──────────────────────────────────────
# POST /app/tabs -> 201. No layout yet — it is an empty tab until something is added.
made = client.create_tab(title="SDK demo")
tab_id = made["tab"]["id"]
print(f"\ncreated tab {tab_id} at index {made['tab']['index']} of window {made['position']['windowId']}")

# POST /app/slots -> 201. An ordered stack: an orderbook with its chart under it, 70/30. "share"
# sits on the SLOT, not inside the content — one written inside a content is silently dropped.
added = client.add_slots(
    [
        {"share": 0.7, "content": {"kind": "orderbook", "exchange": EXCHANGE, "symbol": "BTCUSDT"}},
        {"share": 0.3, "content": {"kind": "chart", "exchange": EXCHANGE, "symbol": "BTCUSDT", "interval": "M5"}},
    ],
    tab_id=tab_id,
    target={"edge": "right"},
    stack="column",
)
print("added: " + " | ".join(f"{s['id'][:8]} {describe(s['content'])}" for s in added["slots"]))

# GET /app/slots/{id} — where the box sits: durable window + tab ids, the index chain, its parent.
book = added["slots"][0]
where = client.get_slot(book["id"])["position"]
print(f"position: tab {where['tabId']} path {where['path']} parent {where.get('parent', '(root)')}")

# PUT /app/slots/{id} — idempotent set. The instrument changes; the SLOT ID DOES NOT.
changed = client.set_slot(book["id"], {"kind": "orderbook", "exchange": EXCHANGE, "symbol": "ETHUSDT"})
print(f"set: {describe(changed['slot']['content'])} — id stable: {changed['slot']['id'] == book['id']}")

# The box can even transition KIND — still the same id.
as_chart = client.set_slot(book["id"], {"kind": "chart", "exchange": EXCHANGE, "symbol": "ETHUSDT", "interval": "M15"})
print(f"kind transition: {describe(as_chart['slot']['content'])} — id stable: {as_chart['slot']['id'] == book['id']}")

# Clearing keeps the box and its id. content is required on a set, so this has its own method.
cleared = client.clear_slot(book["id"])
print(f"cleared: {describe(cleared['slot']['content'])} — box kept: {cleared['slot']['id'] == book['id']}")

# ── tabs: the tri-state title ────────────────────────────────────────────────
# A string renames. Then reorder ALONE — and the name survives, because title is UNSET (the
# default), so the key never reaches the wire. Passing title=None instead would CLEAR it.
client.update_tab(tab_id, title="Scalp")
client.update_tab(tab_id, index=0)
print(f"\nrenamed then reordered — title is still \"{client.get_tab(tab_id)['tab']['title']}\"")

# None is the CLEAR. It restores the automatic coin + count label.
client.update_tab(tab_id, title=None)
print(f"cleared the name — the terminal computes \"{client.get_tab(tab_id)['tab']['title']}\"")

# ── chart windows ────────────────────────────────────────────────────────────
# POST /app/chart-windows answers 200 OR 201: 200 means that (kind, exchange, symbol) was already
# open and the live window was re-homed, which is a success, not an error.
opened = client.open_chart_window("chart", EXCHANGE, "SOLUSDT", interval="M5", tab_id=tab_id)
print(f"\nchart window {opened['status']}: {line(opened['chartWindow'])}")

patched = client.update_chart_window(opened["chartWindow"]["id"], interval="H1", pinned=False)
print(f"patched: {line(patched['chartWindow'])}")
print(f"this tab owns {len(client.list_chart_windows(tab_id=tab_id))} chart window(s)")

# ── tear down ────────────────────────────────────────────────────────────────
client.close_chart_window(opened["chartWindow"]["id"])
# Removing a box is structural — a chart paired under an orderbook goes WITH it, so remove the
# stack back to front; the other order would 404 on a box that is already gone.
for s in reversed(added["slots"]):
    client.remove_slot(s["id"])
# Closing the tab would take its slots and chart windows with it anyway.
client.close_tab(tab_id)
print("\ntorn down")

# ── closed trades (read-only) ────────────────────────────────────────────────
# Every money and size field is a decimal STRING — parse at the edge, never store the float.
connections = client.connections()
if connections:
    cid = connections[0]["id"]
    page = client.list_trades(cid, page_size=5)
    print(f"\n{cid}: {page['totalCount']} closed trade(s), page {page['page']}/{page['totalPages']}")
    for t in page["trades"]:
        print(f"  #{t['id']} {t['side']} {t['symbol']}  {t['openPrice']} -> {t['closePrice']}  net {t['netPnl']} ({t['pnlPercent']}%)")

    # GET one trade WITH its individual venue fills, oldest first.
    if page["trades"]:
        first = page["trades"][0]
        detail = client.get_trade(cid, first["id"])
        print(f"  #{first['id']} is {len(detail['fills'])} fill(s):")
        for f in detail["fills"]:
            print(f"    {'buy ' if f['isBuyer'] else 'sell'} {f['quantity']} @ {f['price']}  fee {f['commission']}")
