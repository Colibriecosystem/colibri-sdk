import { ColibriSocket } from "./socket.js";
import type {
  Balance,
  Book,
  Clusters,
  Connection,
  Funding,
  Order,
  OrderAccepted,
  PanelActionResult,
  PanelContent,
  PanelWindow,
  Ping,
  PlaceOrder,
  Position,
  SignalDirection,
  SignalLevel,
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
      const err = (data && data.error) || {};
      throw new ColibriError(res.status, err.code ?? `http_${res.status}`, err.message ?? text);
    }
    return data as T;
  }

  // ── discovery ────────────────────────────────────────────────────────────
  /** Liveness + version. The ONE token-free route. */
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
  symbols(exchange: string): Promise<SymbolInfo[]> {
    return this.req<{ symbols: SymbolInfo[] }>("GET", `/symbols?exchange=${enc(exchange)}`).then((r) => r.symbols);
  }
  book(exchange: string, symbol: string, opts: { depth?: number; aggregation?: number } = {}): Promise<Book> {
    const q = new URLSearchParams();
    if (opts.depth != null) q.set("depth", String(opts.depth));
    if (opts.aggregation != null) q.set("aggregation", String(opts.aggregation));
    const qs = q.toString();
    return this.req("GET", `/book/${enc(exchange)}/${enc(symbol)}${qs ? "?" + qs : ""}`);
  }
  clusters(exchange: string, symbol: string, timeframe?: string): Promise<Clusters> {
    return this.req("GET", `/clusters/${enc(exchange)}/${enc(symbol)}${timeframe ? "?timeframe=" + enc(timeframe) : ""}`);
  }
  funding(exchange: string, symbol: string): Promise<Funding> {
    return this.req("GET", `/funding/${enc(exchange)}/${enc(symbol)}`);
  }

  // ── account ──────────────────────────────────────────────────────────────
  positions(connectionId: string): Promise<Position[]> {
    return this.req<{ positions: Position[] }>("GET", `/positions?connectionId=${enc(connectionId)}`).then((r) => r.positions);
  }
  orders(connectionId: string): Promise<Order[]> {
    return this.req<{ orders: Order[] }>("GET", `/orders?connectionId=${enc(connectionId)}`).then((r) => r.orders);
  }
  balance(connectionId: string): Promise<Balance[]> {
    return this.req<{ balances: Balance[] }>("GET", `/balance?connectionId=${enc(connectionId)}`).then((r) => r.balances);
  }

  // ── trading (per-connection grant required) ──────────────────────────────
  placeOrder(o: PlaceOrder): Promise<OrderAccepted> {
    return this.req("POST", "/orders", o);
  }
  cancelOrder(clientOrderId: string, connectionId: string): Promise<{ status: string }> {
    return this.req("DELETE", `/orders/${enc(clientOrderId)}?connectionId=${enc(connectionId)}`);
  }
  cancelAll(connectionId: string, exchange: string, symbol: string): Promise<{ status: string }> {
    return this.req("POST", "/orders/cancelAll", { connectionId, exchange, symbol });
  }
  /** The global "Del" panic — cancel every order on one (or, if omitted, every granted) account. */
  panicCancelAllOrders(connectionId?: string): Promise<{ status: string; accounts: number }> {
    return this.req("POST", "/panic/cancel-all-orders", { connectionId });
  }
  /** The global "NumPad0" super-panic — flatten every position + cancel, on one or every granted account. */
  panicCloseAllPositions(connectionId?: string): Promise<{ status: string; accounts: number }> {
    return this.req("POST", "/panic/close-all-positions", { connectionId });
  }

  // ── app bridge ───────────────────────────────────────────────────────────
  /** Open ONE coin on its venue in the terminal (the "see the move → open the book" gesture). */
  openSymbol(exchange: string, symbol: string): Promise<{ opened: boolean }> {
    return this.req("POST", "/app/open-symbol", { exchange, symbol });
  }
  /** Open the coin as a COMBO — one panel per connection that lists it. `target`: "tab" | "window". */
  openCombo(symbol: string, target: "tab" | "window" = "window"): Promise<{ opened: boolean }> {
    return this.req("POST", "/app/open-combo", { symbol, target });
  }

  // ── slot control (/app/panels) ────────────────────────────────────────────
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
   * header's right-click menu). `content[0]` is the orderbook; an optional `content[1]` pairs a chart.
   */
  addPanel(body: { tabId?: string; connectionId?: string; content: PanelContent[] }): Promise<PanelActionResult> {
    return this.req("POST", "/app/panels", body);
  }

  /**
   * Idempotently set a slot's desired state: change the instrument, pair/unpair a chart, bind an
   * account — or CLEAR it with `content: []` (the box stays and keeps its id).
   */
  setPanel(slotId: string, body: { connectionId?: string; content: PanelContent[] }): Promise<PanelActionResult> {
    return this.req("PUT", `/app/panels/${enc(slotId)}`, body);
  }

  /** Remove the slot entirely (its paired chart goes with it). */
  removePanel(slotId: string): Promise<PanelActionResult> {
    return this.req("DELETE", `/app/panels/${enc(slotId)}`);
  }

  // ── notifications & signals ──────────────────────────────────────────────
  /** Raise a toast in the terminal. */
  notify(message: string, severity: "info" | "warning" | "error" = "info", source?: string): Promise<{ ok: boolean }> {
    return this.req("POST", "/notifications", { message, severity, source });
  }
  /** Post a free-text market signal into the terminal's Notifications → API tab. */
  signal(exchange: string, symbol: string, text: string): Promise<{ ok: boolean }> {
    return this.req("POST", "/signals", { exchange, symbol, text });
  }

  // ── signal levels (API-owned price alerts, drawn on the ladder) ───────────
  signalLevels(exchange?: string, symbol?: string): Promise<SignalLevel[]> {
    const q = new URLSearchParams();
    if (exchange) q.set("exchange", exchange);
    if (symbol) q.set("symbol", symbol);
    const qs = q.toString();
    return this.req<{ levels: SignalLevel[] }>("GET", `/signal-levels${qs ? "?" + qs : ""}`).then((r) => r.levels);
  }
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
  deleteSignalLevel(id: string): Promise<void> {
    return this.req("DELETE", `/signal-levels/${enc(id)}`);
  }

  // ── streaming ────────────────────────────────────────────────────────────
  /** Open a WebSocket to `/stream`. Call `.connect()` then `.subscribe(channel, params)`. */
  stream(): ColibriSocket {
    return new ColibriSocket({ base: this.base, token: this.token });
  }
}
