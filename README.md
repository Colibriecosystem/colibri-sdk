# Colibri SDK

Official SDK for the **Colibri Local API** — read the order book, stream trades, and trade from a
widget, screener, or bot. **JavaScript / TypeScript, Python, C#.**

The Local API is a loopback HTTP + WebSocket API exposed by the Colibri scalping terminal. A widget is
an external process that talks to *your own* running terminal over `127.0.0.1`, guarded by a bearer
token — keys never leave the app.

- **Interactive explorer:** <https://colibriecosystem.github.io/colibri-sdk/>
- **API reference:** [`docs/Colibri-Api.md`](docs/Colibri-Api.md)

## Enable the API

In Colibri: **Settings → Program → Local API** → turn it on, copy the **port** + **access token**
(tick **“Allow web browser access”** for a browser widget). Native SDKs auto-discover via
`%APPDATA%\Colibri\localapi.json`.

## Quick start

### JavaScript / TypeScript — [`js/`](js)
```ts
import { ColibriClient } from "@colibri/sdk";

const client = await ColibriClient.discover();           // Node: reads the discovery file
// or: new ColibriClient({ port: 18845, token: "…" })    // browser: paste port + token

console.log(await client.ping());
const book = await client.book("BinanceSpot", "BTCUSDT", { depth: 10 });

const ws = client.stream();
ws.on("trades", (t) => console.log(t));
await ws.connect();
ws.subscribe("trades", { exchange: "BinanceSpot", symbol: "BTCUSDT" });
```

### Python — [`python/`](python)
```python
from colibri import ColibriClient

client = ColibriClient.discover()
print(client.ping())
book = client.book("BinanceSpot", "BTCUSDT", depth=10)

ws = client.stream()
ws.on("trades", lambda data, frame: print(data["trades"]))
ws.connect(); ws.subscribe("trades", exchange="BinanceSpot", symbol="BTCUSDT")
ws.run_forever()
```

### C# — [`dotnet/`](dotnet)
```csharp
using Colibri.Sdk;

using var client = ColibriClient.Discover();
Console.WriteLine((await client.PingAsync()).Version);
var book = await client.BookAsync("BinanceSpot", "BTCUSDT", depth: 10);
```

## What you can do

Read: `/ping` · `/connections` · `/symbols` · `/book` · `/clusters` · `/funding` · `/positions` ·
`/orders` · `/balance`. Trade (per-connection grant): place / cancel / cancel-all / panic. Bridge:
open a symbol or combo in the terminal, raise a toast, post a market signal, manage price-alert
signal levels. Stream: `book`, `trades`, `funding`, `positions`, `orders`, `balance`,
`notifications`, `signalLevels`.

See [`docs/Colibri-Api.md`](docs/Colibri-Api.md) for the full contract and each language's
`examples/` folder for runnable samples.

## Security

Loopback-only, token-guarded, three auth gates (Origin / Host / constant-time token). Reads need the
token; trading needs an explicit per-connection grant. The token is trust between processes under your
user account — treat it like a key.

## License

MIT — see [LICENSE](LICENSE).
