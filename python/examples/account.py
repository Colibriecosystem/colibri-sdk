"""Account — connections, positions, orders, balance.

    python examples/account.py
"""
from colibri import ColibriClient

client = ColibriClient.discover()

# GET /connections
connections = client.connections()
print(f"{len(connections)} connection(s):")
for c in connections:
    print(f"  {c['id']}  {c['label'] or c['exchange']} [{c['marketType']}]  "
          f"trading={c['apiTradingEnabled']}  demo={c['demo']}  viewOnly={c['viewOnly']}")

if not connections:
    raise SystemExit("no connections configured — add one in the terminal first")

conn = connections[0]

# GET /connections/{id}
print("\ndetail:", client.connection(conn["id"]))

# GET /positions?connectionId=
positions = client.positions(conn["id"])
print(f"\npositions ({len(positions)}):")
for p in positions:
    print(f"  {p['symbol']}  {p['side']} {p['quantity']} @ {p['entryPrice']}")

# GET /orders?connectionId=  — includes triggers
orders = client.orders(conn["id"])
print(f"\nopen orders ({len(orders)}):")
for o in orders:
    print(f"  {o['clientOrderId']}  {o['side']} {o['type']} {o['quantity']} @ {o['price']}  {o['status']}")

# GET /balance?connectionId=
balances = client.balance(conn["id"])
print(f"\nbalances ({len(balances)}):")
for b in balances[:8]:
    print(f"  {b['asset']}: free={b['free']}  locked={b['locked']}")
