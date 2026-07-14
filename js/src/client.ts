import { ColibriSocket } from "./socket.js";
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
  PanelActionResult,
  PanelContent,
  PanelWindow,
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
  /** The bearer token from the same place. */
  token: string;
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
 * REST client for the Colibri Local API. Reads work with just the token; trading needs a
 * per-connection grant (Settings → Program → Local API). All numbers on the wire are decimal strings.
 */
export class ColibriClient {
  readonly base: string;
  private readonly token: string;

  constructor(opts: ColibriOptions) {
    this.base = `http://${opts.host ?? "127.0.0.1"}:${opts.port}`;
    this.token = opts.token;
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
        Authorization: `Bearer ${this.token}`,
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
  /** Liveness + version + the live bound port. The ONE token-free route. */
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
  /** GET /markets/{exchange}/{symbol}/clusters — raw 1-minute buckets (merge timeframes yourself); `limit` 1–4320. */
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
  /** DELETE /orders — emergency sweep: cancel every order on EVERY granted account (the terminal's global cancel-all hotkey scope). */
  cancelAllOrders(): Promise<SweepResult> {
    return this.req("DELETE", "/orders");
  }
  /** DELETE /positions — emergency sweep: close every position + cancel leftovers on EVERY granted account (the global super-panic scope). */
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
  ): Promise<PanelActionResult> {
    return this.addPanel({
      activate: true,
      content: { exchange, symbol, views: opts.views ?? ["orderbook"], connectionId: opts.connectionId },
    });
  }
  /** POST /app/combos — open the coin as a COMBO: one panel per connection that lists it. `target`: "tab" | "window". */
  openCombo(symbol: string, target: "tab" | "window" = "window"): Promise<{ status: string }> {
    return this.req("POST", "/app/combos", { symbol, target });
  }

  // ── panel control (/app/panels) ───────────────────────────────────────────
  // A SLOT is the durable box — its GUID `slotId` survives an instrument change, a clear, and a
  // terminal restart, so a tool can drive the same box forever. Add/change/clear are token-gated;
  // a `connectionId` in a body binds a trading account and needs a per-connection GRANT.

  /** The window → tab → slot tree. Scope with `tabId` (durable) and/or `windowIndex` (positional). */
  panels(opts: { tabId?: string; windowIndex?: number } = {}): Promise<PanelWindow[]> {
    const q = new URLSearchParams();
    if (opts.tabId) q.set("tabId", opts.tabId);
    if (opts.windowIndex != null) q.set("windowIndex", String(opts.windowIndex));
    const qs = q.toString();
    return this.req<{ windows: PanelWindow[] }>("GET", `/app/panels${qs ? "?" + qs : ""}`).then((r) => r.windows);
  }

  /**
   * Add a panel to a tab (the ACTIVE tab when `tabId` is omitted — copy a tab's id via the tab
   * header's right-click menu). `content` is ONE instrument + its views; omit it to add an EMPTY
   * "+" box instead — reserve now, fill later by its durable id via {@link setPanel} (each empty
   * add reserves a fresh box). `activate: true` surfaces the terminal window afterwards (default
   * false so a background layout tool never steals focus).
   */
  addPanel(body: { tabId?: string; content?: PanelContent; activate?: boolean } = {}): Promise<PanelActionResult> {
    return this.req("POST", "/app/panels", body);
  }

  /**
   * Idempotently set a slot's desired state: change the instrument, switch views (a kind
   * transition — an orderbook box can become a chart box and back; the id never changes), bind an
   * account — or CLEAR it by omitting `content` (the box stays and keeps its id).
   */
  setPanel(slotId: string, content?: PanelContent): Promise<PanelActionResult> {
    return this.req("PUT", `/app/panels/${enc(slotId)}`, { content });
  }

  /** Remove the slot entirely (its paired chart goes with it). */
  removePanel(slotId: string): Promise<PanelActionResult> {
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
  /** GET /signal-levels — filter by venue / symbol / owning connection. */
  signalLevels(exchange?: string, symbol?: string, connectionId?: string): Promise<SignalLevel[]> {
    const q = new URLSearchParams();
    if (exchange) q.set("exchange", exchange);
    if (symbol) q.set("symbol", symbol);
    if (connectionId) q.set("connectionId", connectionId);
    const qs = q.toString();
    return this.req<{ levels: SignalLevel[] }>("GET", `/signal-levels${qs ? "?" + qs : ""}`).then((r) => r.levels);
  }
  /**
   * POST /signal-levels → 201. A level fires at most once: `oneShot` removes it on fire, else it
   * is kept marked `isTriggered` (sweep with {@link deleteTriggeredSignalLevels}). `connectionId`
   * optionally ties the level to a connection (organizational — no trading grant needed).
   */
  createSignalLevel(l: {
    exchange: string;
    symbol: string;
    price: string;
    direction?: SignalDirection;
    note?: string;
    oneShot?: boolean;
    connectionId?: string;
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
  /** DELETE /signal-levels/triggered — sweep every fired level (all venues/symbols/connections). */
  deleteTriggeredSignalLevels(): Promise<{ removed: number }> {
    return this.req("DELETE", "/signal-levels/triggered");
  }

  // ── streaming ────────────────────────────────────────────────────────────
  /** Open a WebSocket to `/stream`. Call `.connect()` then `.subscribe(channel, params)`. */
  stream(): ColibriSocket {
    return new ColibriSocket({ base: this.base, token: this.token });
  }
}
