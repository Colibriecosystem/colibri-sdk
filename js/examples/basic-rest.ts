// Basic REST: discover the running terminal, then read connections + a book snapshot.
// Run:  node --experimental-strip-types examples/basic-rest.ts
import { ColibriClient } from "../src/index.js";

const client = await ColibriClient.discover(); // reads %APPDATA%\Colibri\localapi.json

const ping = await client.ping();
console.log(`Connected to ${ping.name} ${ping.version} (API ${ping.apiVersion})`);

for (const c of await client.connections()) {
  console.log(`- ${c.label || c.exchange} [${c.marketType}]  trading=${c.apiTradingEnabled}  demo=${c.demo}`);
}

const book = await client.book("BinanceSpot", "BTCUSDT", { depth: 10 });
console.log(`\nBTCUSDT  last=${book.lastPrice}  bid=${book.bestBid}  ask=${book.bestAsk}`);
console.log("top asks:", book.asks.slice(0, 3).map((l) => `${l.price} × ${l.baseQty}`));
console.log("top bids:", book.bids.slice(0, 3).map((l) => `${l.price} × ${l.baseQty}`));
