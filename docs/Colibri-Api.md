# Colibri Local API — Reference

The Colibri Local API is a loopback HTTP/1.1 + WebSocket API that lets an external widget, screener,
or bot read the order book, stream trades, and trade — talking to a **running Colibri terminal** over
`127.0.0.1`. Keys never leave the terminal; the process boundary isolates them.

> **Interactive explorer:** <https://colibriecosystem.github.io/colibri-sdk/> — poke every endpoint live.

---

## Connecting

1. In Colibri: **Settings → Program → Local API** → turn it on. Copy the **port** + **access token**.
   Tick **“Allow web browser access”** if the widget runs in a browser.
2. **Discovery file** (native clients): the terminal writes
   `%APPDATA%\Colibri\localapi.json` = `{ "port", "token", "apiVersion", "pid" }` while the API is on,
   so an SDK auto-connects with zero config. Deleted on shutdown.

**Base URL:** `http://127.0.0.1:<port>` — binds loopback only, never `0.0.0.0`.

## Authentication

Every request except `GET /ping` carries the bearer token:

```
Authorization: Bearer <token>
```

Three gates run on each request/upgrade: **Origin-reject** (browsers blocked unless web access is on) →
**Host-check** (anti-DNS-rebinding) → **constant-time token**. A browser WebSocket can't set the header,
so `/stream` also accepts `?access_token=<token>`.

- **Reads** work with just the token.
- **Trading** additionally needs a **per-connection grant** (Settings → Program → Local API), so a widget
  holding the token can't trade an account you never authorized.

## Numbers & errors

- Prices / sizes / quantities are **decimal strings** (`"64950.10"`) — JSON floats lose crypto tick precision.
- Errors are `{ "error": { "code", "message" } }` with an HTTP status. Codes: `unauthorized`,
  `forbidden_origin`, `unknown_connection`, `unknown_symbol`, `unknown_panel`, `unknown_tab`,
  `trading_not_enabled`, `permission_denied`, `not_ready`, `rate_limited`, `bad_request`,
  `unavailable`, `internal`.

---

## REST endpoints

### Discovery
| Method | Path | Notes |
|---|---|---|
| GET | `/ping` | `{name, version, apiVersion}` — the one token-free route |

### Connections
| Method | Path | Returns |
|---|---|---|
| GET | `/connections` | `{connections: [{id, exchange, marketType, label, demo, viewOnly, apiTradingEnabled}]}` |
| GET | `/connections/{id}` | one connection |

### Market data
| Method | Path | Notes |
|---|---|---|
| GET | `/symbols?exchange=` | `{exchange, symbols: [{symbol, name, baseAsset, quoteAsset, tickSize, stepSize}]}` |
| GET | `/book/{exchange}/{symbol}` | `?depth=` `?aggregation=`. `{exchange, symbol, tickSize, lastPrice, bestBid, bestAsk, bids, asks}` where each level is `{price, baseQty, usdVolume}` |
| GET | `/clusters/{exchange}/{symbol}` | `?timeframe=`. Volume-cluster buckets |
| GET | `/funding/{exchange}/{symbol}` | `{exchange, symbol, rate, nextFundingTimeMs}` (perps) |

### Account (per connection)
| Method | Path | Returns |
|---|---|---|
| GET | `/positions?connectionId=` | `{connectionId, positions: [{symbol, exchange, side, quantity, entryPrice}]}` |
| GET | `/orders?connectionId=` | `{connectionId, orders: [{clientOrderId, exchangeOrderId, symbol, exchange, side, type, status, price, quantity, filledQuantity}]}` |
| GET | `/balance?connectionId=` | `{connectionId, balances: [{asset, free, locked}]}` |
| GET | `/orderbook-settings/{exchange}` | effective render settings (exchange tier) |
| PUT | `/orderbook-settings/{exchange}` | partial patch |

### Trading — grant-gated
| Method | Path | Body / notes |
|---|---|---|
| POST | `/orders` | `{connectionId, exchange, symbol, side, type, price?, sizeQuote?, sizeBase?, reduceOnly?}` → `202 {clientOrderId, status}`. Lifecycle arrives on the WS `orders` channel. |
| DELETE | `/orders/{clientOrderId}?connectionId=` | cancel one |
| POST | `/orders/cancelAll` | `{connectionId, exchange, symbol}` |
| POST | `/panic/cancel-all-orders` | `{connectionId?}` — Del key; omit id → every granted account |
| POST | `/panic/close-all-positions` | `{connectionId?}` — NumPad0 super-panic |

`side` = `BUY`/`SELL`, `type` = `LIMIT`/`MARKET`. Give **either** `sizeQuote` (spend N quote) **or**
`sizeBase` (N coins). `price` only for `LIMIT`. `reduceOnly` closes a position.

### App bridge & signals
| Method | Path | Body |
|---|---|---|
| POST | `/app/open-symbol` | `{exchange, symbol}` — open one coin in the terminal |
| POST | `/app/open-combo` | `{symbol, target}` — fan across every connection (`target`: `tab`\|`window`) |
| POST | `/notifications` | `{message, severity?, source?}` — raise a toast |
| POST | `/signals` | `{exchange, symbol, text}` — post into Notifications → API tab |

### Slot control — drive the terminal's panels by a durable id

A **slot** is the durable box in the terminal's grid — addressed by a GUID `slotId` that survives an
**instrument change**, a **clear**, and a terminal **restart**, so a tool can drive the same box
forever. A **panel** is the content that fills it (an orderbook, optionally paired with a chart).
Copy ids from the terminal once at setup: the **⧉ Copy ID** control on a panel (hover the tool pill;
top-right on an empty box) for a slot, or **right-click a tab header → Copy tab ID** (also in the
tab-settings dialog header) for the `POST` add-target.

| Method | Path | Body / notes |
|---|---|---|
| GET | `/app/panels` | `?tabId=<uuid>` `?windowIndex=N` (optional scoping). → `{windows: [{index, tabs: [{uuid, index, slots: [{slotId, kind, empty, exchange?, symbol?, contentId?, connectionId?, viewOnly, chart?}]}]}]}` |
| POST | `/app/panels` | `{tabId?, connectionId?, content: [...]}` — add a panel to a tab (active tab when `tabId` omitted; a trailing empty "+" box is reused first) |
| PUT | `/app/panels/{slotId}` | `{connectionId?, content: [...]}` — **idempotent** desired-state set: fill / change instrument / pair a chart / bind an account; `content: []` **clears** (the box stays, same id) |
| DELETE | `/app/panels/{slotId}` | remove the slot (its paired chart goes with it) |

`content` = `[{kind, exchange, symbol, interval?}]`, ≤2 items, `content[0]` the orderbook (`kind:
"orderbook"`), optional `content[1]` a paired chart (`kind: "chart"`, `interval` e.g. `"m5"`).
Add / change / clear are display actions — **token only**; a `connectionId` in a body binds a trading
account and is **grant-gated** like trading. Every write pulses the affected panel and logs a row in
the terminal's Notifications → **API** tab. `kind` in the tree is `orderbook`|`chart`|`empty`;
`connectionId: null` = view-only.

### Signal levels (API-owned price alerts, drawn on the ladder)
| Method | Path | Notes |
|---|---|---|
| GET | `/signal-levels?exchange=&symbol=` | `{levels: [...]}` |
| POST | `/signal-levels` | `{exchange, symbol, price, direction?, note?, oneShot?}` → `201`. `direction` ∈ `above`\|`below`\|`cross` |
| DELETE | `/signal-levels/{id}` | remove one |
| DELETE | `/signal-levels?exchange=&symbol=` | clear a symbol → `{removed}` |

---

## WebSocket — `/stream`

Subscribe with a JSON frame, receive live data frames.

```jsonc
// → subscribe
{ "type": "subscribe", "data": { "channel": "trades", "exchange": "BinanceSpot", "symbol": "BTCUSDT" } }
// ← ack
{ "type": "ack", "data": { "channel": "trades", "exchange": "BinanceSpot", "symbol": "BTCUSDT" } }
// ← data
{ "type": "trades", "data": { "exchange": "BinanceSpot", "symbol": "BTCUSDT", "trades": [ { "price": "...", "qty": "...", "isBuy": true, "timeMs": 0 } ] } }
// ← error
{ "type": "error", "data": { "code": "unknown_symbol", "message": "…" } }
```

| Channel | Keyed by | Delivery |
|---|---|---|
| `book` | exchange+symbol | throttled full snapshots (`hz`, `depth`) |
| `trades` | exchange+symbol | incremental (one frame per new print) |
| `funding` | exchange+symbol | on change |
| `positions` / `orders` / `balance` | `connectionId` | full snapshot on change |
| `notifications` | — | terminal notifications (secret-free) |
| `signalLevels` | — | `placed` / `removed` / `triggered` events |

Unsubscribe with `{ "type": "unsubscribe", "data": { "channel": … } }`. Market-data frames are dropped
latest-wins under backpressure; account frames are reliable.

---

## SDKs

Typed clients (REST + WebSocket + discovery) live in this repo:
[`js/`](../js) · [`python/`](../python) · [`dotnet/`](../dotnet).
