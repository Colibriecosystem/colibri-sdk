# Colibri SDK

Official SDK for the **Colibri Local API** — read the order book, stream trades, and trade from a
widget, screener, or bot. **JavaScript / TypeScript, Python, C#.**

The Local API is a loopback HTTP + WebSocket API exposed by the Colibri scalping terminal. A widget is
an external process that talks to *your own* running terminal over `127.0.0.1`. Reading and streaming
need **no credential at all**; placing or cancelling orders needs a bearer token plus a per-connection
grant. Exchange keys never leave the app.

- **Interactive REST reference:** <https://colibriecosystem.github.io/colibri-sdk/> — Stoplight
  Elements (three-panel docs + inline try-it) rendered from
  [`docs/openapi.yaml`](docs/openapi.yaml), the machine-readable contract
- **WebSocket reference:** <https://colibriecosystem.github.io/colibri-sdk/ws.html> — AsyncAPI
  rendering of [`docs/asyncapi.yaml`](docs/asyncapi.yaml), the `/stream` protocol
- **Basics + route summary:** [`docs/Colibri-Api.md`](docs/Colibri-Api.md)

This site also hosts the terminal's **builder-code approval page**
(<https://colibriecosystem.github.io/colibri-sdk/approve/>, [`docs/approve/`](docs/approve)). It is
not part of the SDK surface: Colibri shows a QR, the user scans it with their phone wallet, and the
page signs the venue's EIP-712 builder-fee approval inside the wallet app and submits it to the
venue. No private key is ever entered, and the page is opened only via that QR.

## Enable the API

In Colibri: **Settings → Program → Local API** → turn it on and copy the **port**. Copy the **access
token** too if your widget will trade (tick **“Allow web browser access”** for a browser widget).
Native SDKs auto-discover both via `%APPDATA%\Colibri\localapi.json`.

## Quick start

### JavaScript / TypeScript — [`js/`](js)
```ts
import { ColibriClient } from "@colibri/sdk";

const client = await ColibriClient.discover();           // Node: reads the discovery file
// or: new ColibriClient({ port: 18845 })                // read-only widget — no token needed
// or: new ColibriClient({ port: 18845, token: "…" })    // + can place / cancel orders

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

Read: `/ping` · `/exchanges` · `/exchanges/{exchange}/symbols` · `/markets/{exchange}/{symbol}/book`
· `…/clusters` · `…/funding` · `/connections` · `/connections/{id}/positions|orders|balances` ·
orderbook settings (GET/PATCH). Trade (per-connection grant; the venue derives from the connection):
place / cancel / bulk cancel (`/connections/{id}/orders`), close positions
(`/connections/{id}/positions`), and the all-granted sweeps (`DELETE /orders`,
`DELETE /positions`). Bridge: open a symbol or combo in the terminal, raise a toast, post a market
signal, manage price-alert signal levels (incl. the triggered-lifecycle sweep). **Panel control**
(`/app/panels`): enumerate the terminal's window → tab → slot tree and drive any panel by its
**durable slot id** (survives an instrument change, a clear, and restart) — add / change / clear /
remove a panel, pair a chart, bind a granted trading account. Stream: `book`, `trades`, `funding`,
`positions`, `orders`, `balance`, `notifications`, `signalLevels`.

See [`docs/Colibri-Api.md`](docs/Colibri-Api.md) for the full contract.

## Examples

Every endpoint has a runnable example (`js/examples/`, `python/examples/`, and the C# walk-through
in `dotnet/Colibri.Sdk.Examples`):

| Example | Covers |
|---|---|
| `basic-rest` | ping · connections · book |
| `market-data` | symbols · book · clusters · funding |
| `account` | connections · positions · orders · balance |
| `trading` | place · cancel · bulk cancel · all-granted sweeps *(grant-gated; armed via `COLIBRI_ARM=1` / `--arm`)* |
| `app-and-signals` | open-symbol · combo · notify · signal · signal-levels CRUD + triggered sweep |
| `panels` | panel control: tree → add → change (id stable) → clear → remove |
| `orderbook-stream` / `live-trades` | focused WebSocket streams |
| `stream-all` | every WS channel at once |

## Security

Loopback-only. Two gates run on every request and on the WebSocket upgrade: **Origin-reject**
(browsers are blocked unless you tick "Allow web browser access") and a loopback **Host-check**
(anti-DNS-rebinding).

The **bearer token gates one thing: moving money** — placing an order, cancelling one, closing
positions, and the two all-account sweeps. Trading needs an explicit **per-connection grant** on top,
so a token alone cannot touch an account you never authorized.

Everything else is open, including the account reads and the whole WebSocket. Know what that means:
any process running as your Windows user can read your positions, PnL and balances and can move the
terminal's windows around — and with browser access on, so can any site you have open. That is the
deliberate trade-off for zero-friction widgets. Treat the token like a key; it is the wall around
your money.

## License

MIT — see [LICENSE](LICENSE).
