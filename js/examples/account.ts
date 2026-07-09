// Account — connections, positions, orders, balance (per connection).
// Run:  npx tsx examples/account.ts
import { ColibriClient } from "../src/index.js";

const client = await ColibriClient.discover();

// GET /connections  — every configured account
const connections = await client.connections();
console.log(`${connections.length} connection(s):`);
for (const c of connections) {
  console.log(`  ${c.id}  ${c.label || c.exchange} [${c.marketType}]  trading=${c.apiTradingEnabled}  demo=${c.demo}  viewOnly=${c.viewOnly}`);
}

const conn = connections[0];
if (!conn) {
  console.log("no connections configured — add one in the terminal first");
  process.exit(0);
}

// GET /connections/{id}
console.log("\ndetail:", await client.connection(conn.id));

// GET /positions?connectionId=
const positions = await client.positions(conn.id);
console.log(`\npositions (${positions.length}):`);
for (const p of positions) console.log(`  ${p.symbol}  ${p.side} ${p.quantity} @ ${p.entryPrice}`);

// GET /orders?connectionId=  — open orders incl. triggers
const orders = await client.orders(conn.id);
console.log(`\nopen orders (${orders.length}):`);
for (const o of orders) console.log(`  ${o.clientOrderId}  ${o.side} ${o.type} ${o.quantity} @ ${o.price}  ${o.status}`);

// GET /balance?connectionId=
const balances = await client.balance(conn.id);
console.log(`\nbalances (${balances.length}):`);
for (const b of balances.slice(0, 8)) console.log(`  ${b.asset}: free=${b.free}  locked=${b.locked}`);
