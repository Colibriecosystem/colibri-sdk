# Colibri Local API — Reference

The Colibri Local API is a loopback HTTP/1.1 + WebSocket API that lets an external widget, screener,
or bot read the order book, stream trades, and trade — talking to a **running Colibri terminal** over
`127.0.0.1`. Keys never leave the terminal; the process boundary isolates them.

> **Full reference:** the machine-readable contract is [`openapi.yaml`](openapi.yaml), rendered as an
> interactive Scalar page at <https://colibriecosystem.github.io/colibri-sdk/> — every operation,
> parameter, schema, and error code, with a live *try-it* console. This file keeps only the
> connection/auth basics and a route summary.

---

## Connecting

1. In Colibri: **Settings → Program → Local API** → turn it on. Copy the **port** + **access token**.
   Tick **“Allow web browser access”** if the widget runs in a browser (the Scalar page's try-it
   console needs it too).
2. **Discovery file** (native clients): the terminal writes
   `%APPDATA%\Colibri\localapi.json` = `{ "port", "token", "apiVersion", "pid" }` while the API is on,
   so an SDK auto-connects with zero config. Deleted on shutdown. `apiVersion` is currently `1`.

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
  holding the token can't trade an account you never authorized. A connection is bound to exactly one
  venue — the exchange always derives FROM the connection, never a request parameter.

## Numbers & errors

- Prices / sizes / quantities are **decimal strings** (`"64950.10"`) — JSON floats lose crypto tick precision.
- Times are unix **milliseconds** (`…Ms` fields); cluster buckets carry `startUnixSec` (unix seconds).
- Errors are a top-level `{ "code", "message" }` with an HTTP status. Codes: `unauthorized`,
  `forbidden_origin`, `forbidden_host`, `not_found`, `unknown_connection`, `unknown_symbol`,
  `unknown_panel`, `unknown_tab`, `trading_not_enabled`, `permission_denied`, `not_ready`,
  `rate_limited`, `bad_request`, `unavailable`, `internal`.
- Accepted trading mutations answer **`202`** — the command is *enqueued* (the same fire-and-forget
  path a terminal click uses); exchange confirmation arrives on the WS `orders` channel.

---

## Route summary

Resources nest under their owner (the RESTful redesign, 2026-07): a venue's data under
`/exchanges/{exchange}` and `/markets/{exchange}/{symbol}`, an account's data + trading under
`/connections/{id}`, the all-granted emergency sweeps at the top-level collections. Full
request/response shapes live in [`openapi.yaml`](openapi.yaml).

| Method | Path | Notes |
|---|---|---|
| GET | `/ping` | `{name, version, apiVersion, port}` — the one token-free route |
| GET | `/exchanges` | the venue catalog — `id` is the string every `{exchange}` accepts; `trading:false` = view-only venue |
| GET | `/exchanges/{exchange}/symbols` | the venue's symbol universe + metadata |
| GET | `/markets/{exchange}/{symbol}/book` | `?depth=` (1–500). Dual-unit book snapshot |
| GET | `/markets/{exchange}/{symbol}/clusters` | `?limit=` (1–4320). Raw 1-minute footprint buckets, oldest → newest — merge timeframes client-side |
| GET | `/markets/{exchange}/{symbol}/funding` | perp funding (spot → 404 `unavailable`) |
| GET / PATCH | `/exchanges/{exchange}/orderbook-settings` | effective render settings (exchange tier) / partial patch |
| GET | `/connections` | `{connections: [{id, exchange, marketType, label, demo, viewOnly, apiTradingEnabled}]}` |
| GET | `/connections/{id}` | one connection |
| GET | `/connections/{id}/positions` \| `/orders` \| `/balances` | account reads |
| POST | `/connections/{id}/orders` | `{symbol, side, type, price?, sizeQuote?, sizeBase?, reduceOnly?}` → `202 {clientOrderId, status}` — grant-gated; the venue derives from the connection |
| DELETE | `/connections/{id}/orders/{clientOrderId}?symbol=` | cancel one (symbol required) → `202` |
| DELETE | `/connections/{id}/orders[?symbol=]` | bulk cancel: one symbol, or the whole account when unscoped → `202` |
| DELETE | `/connections/{id}/positions` | close every position + cancel leftovers on the account → `202` |
| DELETE | `/orders` | **emergency sweep**: cancel every order on EVERY granted account → `202 {status, accounts}` |
| DELETE | `/positions` | **emergency sweep**: close every position on EVERY granted account → `202 {status, accounts}` |
| GET | `/app/panels` | `?tabId=` `?windowIndex=` — the window → tab → slot tree |
| POST | `/app/panels` | `{tabId?, content?, activate?}` → `201` — add a panel (null content = empty "+" box; `activate` surfaces the window — the open-symbol gesture) |
| PUT | `/app/panels/{slotId}` | `{content?}` — idempotent desired-state set (kind transitions ok; null content = clear, box keeps its id) |
| DELETE | `/app/panels/{slotId}` | remove the slot (its paired chart goes with it) |
| POST | `/app/combos` | `{symbol, target?}` → `201` — fan across every connection (`target`: `tab`\|`window`) |
| POST | `/notifications` | `{message, severity?, source?}` — raise a toast |
| POST | `/signals` | `{exchange, symbol, text}` — post into Notifications → API tab |
| GET | `/signal-levels` | `?exchange=` `?symbol=` → `{levels}` |
| POST | `/signal-levels` | `{exchange, symbol, price, direction?, note?, oneShot?}` → `201` SignalLevel |
| DELETE | `/signal-levels/{id}` | remove one → `{removed}` |
| DELETE | `/signal-levels?exchange=&symbol=` | clear a symbol → `{removed}` |
| DELETE | `/signal-levels/triggered` | sweep every fired level → `{removed}` |

**Signal-level lifecycle:** a level fires **at most once**. `oneShot: true` → auto-removed on fire;
`oneShot: false` (default) → kept, marked `isTriggered` + `triggeredMs` (an audit row — sweep via
`DELETE /signal-levels/triggered`). A level is a pure market alert — venue + symbol only, never
tied to a connection.

**Panel control:** a **slot** is the durable box in the terminal's grid — its GUID `slotId` survives
an instrument change, a clear, a view/kind transition, and a terminal restart. A **panel** is the
content that fills it. Copy ids in the terminal: the **⧉ Copy ID** control on a panel (top-right on
an empty box) for a slot; **right-click a tab header → Copy tab ID** for the `POST` add-target.
`content` = ONE instrument + the views that render it (`{connectionId?, exchange, symbol, views}`,
`views` ⊆ `["orderbook","chart"]`). Omitted `connectionId` = the app adopts the venue's default
connection by itself (no grant needed — the app picks, not the API).

## Parameter reference

| Param | Where | Type / values | Notes |
|---|---|---|---|
| `exchange` | market data, signals, panels `content`, signal levels | string — an `id` from **`GET /exchanges`** (e.g. `BinanceSpot`, `BinanceLinearFutures`, `BybitLinearPerpetual`) | Enum names, case-insensitive on parse; a venue with `trading: false` is view-only. Trading routes need NO exchange — the connection determines it |
| `symbol` | same | string, the venue's wire symbol (`BTCUSDT`; quote-first venues keep their native form, e.g. UpBit `KRW-BTC`) | From `GET /exchanges/{exchange}/symbols` |
| `views` | panels `content` | array — `"orderbook"`, `"chart"` (dedup, ≥1) | `["chart"]` = a standalone chart slot; both = the pair (chart stacked under the orderbook, same instrument, app-default timeframe) |
| `connectionId` | trading URLs, panels `content` | string — an `id` from `GET /connections` | Trading + panel binding are **grant-gated** (Settings → Program → Local API). Panels: requires the orderbook view; omitted = the app adopts the venue's default connection |
| `tabId` | `POST /app/panels`, `GET ?tabId=` | GUID ("N" form) — a tab's durable id | Copy: right-click a tab header → **Copy tab ID** |
| `slotId` | `/app/panels/{slotId}` | GUID ("N" form) — the durable box handle | Copy: the ⧉ control on a panel; survives change / clear / restart |
| `windowIndex` | `GET /app/panels?windowIndex=` | int ≥ 0, positional | Out-of-range → empty tree (window ids are not durable yet) |
| `activate` | `POST /app/panels` | bool, default `false` | Surface the terminal window after the add — the "see the move → open the book" gesture |
| `side` | place order | `BUY` \| `SELL` (case-insensitive) | |
| `type` | place order | `Limit` \| `Market` (case-insensitive) | `price` required for Limit, forbidden for Market; trigger types are a documented follow-up |
| `sizeQuote` / `sizeBase` | place order | decimal string | Exactly one positive: spend N quote vs N coins |
| `reduceOnly` | place order | bool, default `false` | Closing order — never increases the position (futures) |
| `depth` | book (REST + WS) | int 1–500, default 50 | Levels per side |
| `limit` | clusters | int 1–4320, default 60 | 1-minute buckets, newest kept |
| `direction` | signal levels | `above` \| `below` \| `cross` (requests, case-insensitive) | Default `cross`; responses echo the enum name (`Above`/`Below`/`Cross`) |
| `oneShot` | signal levels | bool, default `false` | true = remove on fire; false = keep, marked `isTriggered` |
| `severity` | `POST /notifications` | `info` \| `success` \| `warning` \| `error` | Default `info` |
| Prices / sizes | everywhere | decimal **strings** | JSON floats lose crypto tick precision |

---

## WebSocket — `/stream`

Subscribe with a JSON frame, receive live data frames. `id` is optional and echoed on acks/errors.

```jsonc
// → subscribe
{ "type": "subscribe", "data": { "channel": "trades", "exchange": "BinanceSpot", "symbol": "BTCUSDT" }, "id": "1" }
// ← ack
{ "type": "subscribed", "data": { "channel": "trades", "exchange": "BinanceSpot", "symbol": "BTCUSDT" }, "id": "1" }
// ← data
{ "type": "trades", "data": { "exchange": "BinanceSpot", "symbol": "BTCUSDT", "trades": [ { "price": "...", "qty": "...", "isBuy": true, "timeMs": 0 } ] } }
// ← error
{ "type": "error", "data": { "code": "bad_request", "message": "…" }, "id": "1" }
```

| Channel | Keyed by | Delivery |
|---|---|---|
| `book` | exchange+symbol | throttled full snapshots (`hz` 1–10, `depth` 1–500), sent only on change |
| `trades` | exchange+symbol | incremental — batches of new prints, oldest → newest |
| `funding` | exchange+symbol | on change |
| `positions` / `orders` / `balance` | `connectionId` | full snapshot on change |
| `notifications` | — | terminal notifications (secret-free); backlog replayed after the ack, then live. Frame type: `notification` |
| `signalLevels` | — | `placed` / `removed` / `triggered` events; the current set replays as `placed` after the ack. Frame type: `signalLevel` (`{type, event, data}`) |

Unsubscribe with `{ "type": "unsubscribe", "data": { "channel": …, … } }` → `unsubscribed`. Market-data
frames are dropped latest-wins under backpressure; acks / errors / notifications / signal-level events
ride a reliable lane (a client that stops reading is disconnected).

---

## SDKs

Typed clients (REST + WebSocket + discovery) live in this repo:
[`js/`](../js) · [`python/`](../python) · [`dotnet/`](../dotnet).
