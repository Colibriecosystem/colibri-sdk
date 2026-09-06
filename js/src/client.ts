import { ColibriSocket } from "./socket.js";
import { API_VERSION } from "./types.js";
import type {
  Balance,
  Book,
  Clusters,
  Connection,
  ExchangeInfo,
  Funding,
  Order,
  OrderAccepted,
  OrderbookSettings,
  AddPanelsBody,
  EmptyContent,
  PanelContent,
  PanelWindow,
  PlaceableContent,
  SlotAction,
  SlotLookup,
  Ping,
  PlaceOrder,
  Position,
  SignalDirection,
  SignalLevel,
  SweepResult,
  SymbolInfo,
} from "./types.js";

export interface ColibriOptions {
  /** The port from Settings → Program → Local API (or the discovery file). */
  port: number | string;
  /**
   * The bearer token from the same place. **Only needed to place or cancel orders** — every
   * read, the panel/settings gestures, and the WebSocket are open. Omit it for a read-only
   * widget and the client simply sends no `Authorization` header.
   */
  token?: string;
  /** Defaults to 127.0.0.1 — the API only ever binds loopback. */
  host?: string;
}

/** A typed error carrying the API's `{code, message}` (or the HTTP status when there is no envelope). */
export class ColibriError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ColibriError";
  }
}

const enc = encodeURIComponent;

/**
 * REST client for the Colibri Local API. Reads need no credential at all; **trading** needs the
 * bearer token AND a per-connection grant (Settings → Program → Local API). All numbers on the
 * wire are decimal strings.
 */
export class ColibriClient {
  readonly base: string;
  private readonly token: string;

  constructor(opts: ColibriOptions) {
    this.base = `http://${opts.host ?? "127.0.0.1"}:${opts.port}`;
    this.token = opts.token ?? "";
  }

  /**
   * Node only: auto-connect by reading the discovery file the terminal writes while the API is on
   * (`%APPDATA%\Colibri\localapi.json` = `{port, token, apiVersion, pid}`). Zero manual config.
   */
  static async discover(host?: string): Promise<ColibriClient> {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const appData = process.env.APPDATA ?? join(process.env.HOME ?? "", ".config");
    const file = join(appData, "Colibri", "localapi.json");
    const j = JSON.parse(await readFile(file, "utf8")) as { port: number; token: string };
    return new ColibriClient({ port: j.port, token: j.token, host });
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        // The response-shape version this SDK reads (see API_VERSION). Only /app/panels has two
        // shapes today; every other route ignores it.
        "api-version": String(API_VERSION),
        // Omitted entirely when no token was supplied — open routes take no credential, and
        // sending `Bearer ` would be a malformed header rather than "no auth".
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      // Error bodies are a top-level { code, message }.
      throw new ColibriError(res.status, data?.code ?? `http_${res.status}`, data?.message ?? text);
    }
    return data as T;
  }

  // ── discovery ────────────────────────────────────────────────────────────
  /** Liveness + version + the live bound port. */
  ping(): Promise<Ping> {
    return this.req("GET", "/ping");
  }

  // ── connections ──────────────────────────────────────────────────────────
  connections(): Promise<Connection[]> {
    return this.req<{ connections: Connection[] }>("GET", "/connections").then((r) => r.connections);
  }
  connection(id: string): Promise<Connection> {
    return this.req("GET", `/connections/${enc(id)}`);
  }

  // ── market data ──────────────────────────────────────────────────────────
  /** The venue catalog — `id` is the string every `exchange` param accepts; `trading:false` = view-only venue. */
  exchanges(): Promise<ExchangeInfo[]> {
    return this.req<{ exchanges: ExchangeInfo[] }>("GET", "/exchanges").then((r) => r.exchanges);
  }
  /** GET /exchanges/{exchange}/symbols — the venue's symbol universe. */
  symbols(exchange: string): Promise<SymbolInfo[]> {
    return this.req<{ symbols: SymbolInfo[] }>("GET", `/exchanges/${enc(exchange)}/symbols`).then((r) => r.symbols);
  }
  /** GET /markets/{exchange}/{symbol}/book — dual-unit snapshot; `depth` = levels per side (1–500, default 50). */
  book(exchange: string, symbol: string, opts: { depth?: number } = {}): Promise<Book> {
    const qs = opts.depth != null ? `?depth=${opts.depth}` : "";
    return this.req("GET", `/markets/${enc(exchange)}/${enc(symbol)}/book${qs}`);
  }
  /** GET /markets/{exchange}/{symbol}/clusters — raw 15-second base buckets (merge timeframes yourself); `limit` 1–17280 (72 h), default 240 = the last hour. */
  clusters(exchange: string, symbol: string, limit?: number): Promise<Clusters> {
    const qs = limit != null ? `?limit=${limit}` : "";
    return this.req("GET", `/markets/${enc(exchange)}/${enc(symbol)}/clusters${qs}`);
  }
  /** GET /markets/{exchange}/{symbol}/funding — perps only (spot answers 404 `unavailable`). */
  funding(exchange: string, symbol: string): Promise<Funding> {
    return this.req("GET", `/markets/${enc(exchange)}/${enc(symbol)}/funding`);
  }

  // ── orderbook settings (exchange tier) ────────────────────────────────────
  /** GET /exchanges/{exchange}/orderbook-settings — the EFFECTIVE render settings for the venue. */
  orderbookSettings(exchange: string): Promise<{ exchange: string; settings: OrderbookSettings }> {
    return this.req("GET", `/exchanges/${enc(exchange)}/orderbook-settings`);
  }
  /** PATCH /exchanges/{exchange}/orderbook-settings — partial update: only the fields present change. */
  patchOrderbookSettings(exchange: string, patch: OrderbookSettings): Promise<{ exchange: string; settings: OrderbookSettings }> {
    return this.req("PATCH", `/exchanges/${enc(exchange)}/orderbook-settings`, patch);
  }

  // ── account (per connection) ──────────────────────────────────────────────
  positions(connectionId: string): Promise<Position[]> {
    return this.req<{ positions: Position[] }>("GET", `/connections/${enc(connectionId)}/positions`).then((r) => r.positions);
  }
  orders(connectionId: string): Promise<Order[]> {
    return this.req<{ orders: Order[] }>("GET", `/connections/${enc(connectionId)}/orders`).then((r) => r.orders);
  }
  balance(connectionId: string): Promise<Balance[]> {
    return this.req<{ balances: Balance[] }>("GET", `/connections/${enc(connectionId)}/balances`).then((r) => r.balances);
  }

  // ── trading (per-connection grant required) ──────────────────────────────
  /**
   * POST /connections/{id}/orders → 202 {clientOrderId, status}. The venue derives from the
   * connection, so the order body carries only the instrument + shape. Lifecycle then arrives on
   * the WS `orders` channel.
   */
  placeOrder(connectionId: string, order: PlaceOrder): Promise<OrderAccepted> {
    return this.req("POST", `/connections/${enc(connectionId)}/orders`, order);
  }
  /** DELETE /connections/{id}/orders/{clientOrderId}?symbol= — cancel one order (symbol required). */
  cancelOrder(connectionId: string, clientOrderId: string, symbol: string): Promise<{ status: string }> {
    return this.req("DELETE", `/connections/${enc(connectionId)}/orders/${enc(clientOrderId)}?symbol=${enc(symbol)}`);
  }
  /**
   * DELETE /connections/{id}/orders[?symbol=] — bulk cancel on one connection: with `symbol` every
   * working order for that symbol; without, every order across the whole account (positions untouched).
   */
  cancelAll(connectionId: string, symbol?: string): Promise<{ status: string }> {
    const qs = symbol ? `?symbol=${enc(symbol)}` : "";
    return this.req("DELETE", `/connections/${enc(connectionId)}/orders${qs}`);
  }
  /** DELETE /connections/{id}/positions — close every position + cancel leftovers on one connection. */
  closePositions(connectionId: string): Promise<{ status: string }> {
    return this.req("DELETE", `/connections/${enc(connectionId)}/positions`);
  }
  /** DELETE /orders — cancel every order on EVERY granted account (the terminal's global cancel-all hotkey scope). */
  cancelAllOrders(): Promise<SweepResult> {
    return this.req("DELETE", "/orders");
  }
  /** DELETE /positions — close every position + cancel leftovers on EVERY granted account (the terminal's global close-all hotkey scope). */
  closeAllPositions(): Promise<SweepResult> {
    return this.req("DELETE", "/positions");
  }

  // ── app bridge ───────────────────────────────────────────────────────────
  /**
   * Open ONE coin in the ACTIVE tab + surface the window (the "see the move → open the book"
   * gesture). Convenience wrapper over {@link addPanel} with `activate: true` — same optional
   * `connectionId` (grant-gated) / `views` (default `["orderbook"]`) semantics — answering 201
   * with the created slot, so the tool can keep driving it by its durable id.
   */
  openSymbol(
    exchange: string,
    symbol: string,
    opts: { connectionId?: string; views?: ("orderbook" | "chart")[] } = {},
  ): Promise<SlotAction> {
    return this.addPanel({
      activate: true,
      content: { exchange, symbol, views: opts.views ?? ["orderbook"], connectionId: opts.connectionId },
    });
  }
  /** POST /app/combos — open the coin as a COMBO: one panel per connection that lists it. `target`: "tab" | "window". */
  openCombo(symbol: string, target: "tab" | "window" = "window"): Promise<{ status: string }> {
    return this.req("POST", "/app/combos", { symbol, target });
  }

  // ── panel control (/app/panels, api-version 2) ───────────────────────────
  // A SLOT is the durable box — its GUID `id` survives an instrument change, a clear, a kind
  // transition, and a terminal restart, so a tool can drive the same box forever. A tab is ONE
  // layout tree where a leaf IS the slot. Add/change/clear are token-gated; a `connectionId` in a
  // body binds a trading account and needs a per-connection GRANT. A widget box is visible here
  // but never placed, changed or cleared through the API (409).

  /** The window → tab → layout tree. Scope with `tabId` (durable) and/or `windowIndex` (positional). */
  panels(opts: { tabId?: string; windowIndex?: number } = {}): Promise<PanelWindow[]> {
    const q = new URLSearchParams();
    if (opts.tabId) q.set("tabId", opts.tabId);
    if (opts.windowIndex != null) q.set("windowIndex", String(opts.windowIndex));
    const qs = q.toString();
    return this.req<{ windows: PanelWindow[] }>("GET", `/app/panels${qs ? "?" + qs : ""}`).then((r) => r.windows);
  }

  /** One slot — byte-identical to its leaf in the tree — plus where it sits (its parent split, path, depth). */
  panel(slotId: string): Promise<SlotLookup> {
    return this.req("GET", `/app/panels/${enc(slotId)}`);
  }

  /**
   * Add to a tab (the ACTIVE tab when `tabId` is omitted — copy a tab's id via the tab header's
   * right-click menu). `contents` is an ordered STACK, each item its own box, optionally
   * positioned by `target` (beside an existing slot, the drag-drop vocabulary) and sized by
   * per-item `share`; `content` is ONE box (`{kind:"empty"}` or an empty body reserves a bare "+"
   * box — fill it later by its durable id via {@link setPanel}). `activate: true` surfaces the
   * terminal window afterwards (default false so a background layout tool never steals focus).
   */
  addPanel(body: AddPanelsBody = {}): Promise<SlotAction> {
    return this.req("POST", "/app/panels", body);
  }

  /** {@link addPanel} for a stack: `contents` in order, positioned by `target`, stacked per `orientation`. */
  addPanels(contents: PlaceableContent[], opts: Omit<AddPanelsBody, "contents" | "content"> = {}): Promise<SlotAction> {
    return this.addPanel({ ...opts, contents });
  }

  /**
   * Idempotently set what ONE box holds: `{kind:"orderbook"|"chart", …}` (a kind transition is
   * fine — the id never changes; a chart docked beside the box is its own box and is left alone),
   * or omit `content` / pass `{kind:"empty"}` to CLEAR it (the box stays and keeps its id). The
   * legacy `views` form is still accepted. On a widget box every set is refused (409).
   */
  setPanel(slotId: string, content?: PlaceableContent | EmptyContent | PanelContent): Promise<SlotAction> {
    return this.req("PUT", `/app/panels/${enc(slotId)}`, { content });
  }

  /** Remove the slot entirely (its paired chart goes with it). */
  removePanel(slotId: string): Promise<SlotAction> {
    return this.req("DELETE", `/app/panels/${enc(slotId)}`);
  }

  // ── notifications & signals ──────────────────────────────────────────────
  /** Raise a toast in the terminal (max 500 chars). */
  notify(
    message: string,
    severity: "info" | "success" | "warning" | "error" = "info",
    source?: string,
  ): Promise<{ status: string }> {
    return this.req("POST", "/notifications", { message, severity, source });
  }
  /** Post a free-text market signal into the terminal's Notifications → API tab (max 200 chars). */
  signal(exchange: string, symbol: string, text: string): Promise<{ status: string }> {
    return this.req("POST", "/signals", { exchange, symbol, text });
  }

  // ── signal levels (API-owned price alerts, drawn on the ladder) ───────────
  /** GET /signal-levels — filter by venue / symbol. */
  signalLevels(exchange?: string, symbol?: string): Promise<SignalLevel[]> {
    const q = new URLSearchParams();
    if (exchange) q.set("exchange", exchange);
    if (symbol) q.set("symbol", symbol);
    const qs = q.toString();
    return this.req<{ levels: SignalLevel[] }>("GET", `/signal-levels${qs ? "?" + qs : ""}`).then((r) => r.levels);
  }
  /**
   * POST /signal-levels → 201. A level fires at most once: `oneShot` removes it on fire, else it
   * is kept marked `isTriggered` (sweep with {@link deleteTriggeredSignalLevels}). A level is a
   * pure market alert — venue + symbol only, never tied to a connection.
   */
  createSignalLevel(l: {
    exchange: string;
    symbol: string;
    price: string;
    direction?: SignalDirection;
    note?: string;
    oneShot?: boolean;
  }): Promise<SignalLevel> {
    return this.req("POST", "/signal-levels", l);
  }
  /** DELETE /signal-levels/{id} → {removed: 1}. */
  deleteSignalLevel(id: string): Promise<{ removed: number }> {
    return this.req("DELETE", `/signal-levels/${enc(id)}`);
  }
  /** DELETE /signal-levels?exchange=&symbol= — clear every level of one symbol. */
  deleteSignalLevels(exchange: string, symbol: string): Promise<{ removed: number }> {
    return this.req("DELETE", `/signal-levels?exchange=${enc(exchange)}&symbol=${enc(symbol)}`);
  }
  /** DELETE /signal-levels/triggered — sweep every fired level (all venues/symbols). */
  deleteTriggeredSignalLevels(): Promise<{ removed: number }> {
    return this.req("DELETE", "/signal-levels/triggered");
  }

  // ── streaming ────────────────────────────────────────────────────────────
  /** Open a WebSocket to `/stream`. Call `.connect()` then `.subscribe(channel, params)`. */
  stream(): ColibriSocket {
    return new ColibriSocket({ base: this.base, token: this.token });
  }
}
