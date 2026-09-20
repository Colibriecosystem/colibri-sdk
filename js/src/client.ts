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
  AddSlotsBody,
  ChartWindow,
  ChartWindowAction,
  ChartWindowKind,
  ChartWindowRemoved,
  ClosedTradeDetail,
  ClosedTradesPage,
  CreateTabBody,
  OpenChartWindowBody,
  SettableContent,
  SlotChanged,
  SlotRemoved,
  SlotsAdded,
  TabAction,
  TabLookup,
  TabRemoved,
  UpdateChartWindowBody,
  UpdateTabBody,
  WindowAction,
  WindowSummary,
  WorkspaceSlotLookup,
  WorkspaceWindow,
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
 * Re-emit a content object with `kind` FIRST. The terminal resolves a write content union by a
 * discriminator it expects to read before anything else, and a content that leads with another key
 * fails the parse rather than answering a 400 — so the order is part of the contract, not style.
 */
const kindFirst = <T extends { kind: string }>(content: T): T => {
  const { kind, ...rest } = content;
  return { kind, ...rest } as T;
};

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

  /**
   * GET /connections/{id}/trades — CLOSED-trade history, newest close first. `fromMs`/`toMs` bound
   * the CLOSE time and are half-open `[fromMs, toMs)`; a value the terminal cannot parse reads as
   * "not supplied" rather than erroring. `pageSize` is 1–500 (default 100). A row is AMENDABLE
   * after it is written, so a poller should re-read rather than cache.
   */
  listTrades(
    connectionId: string,
    opts: { page?: number; pageSize?: number; symbol?: string; fromMs?: number; toMs?: number } = {},
  ): Promise<ClosedTradesPage> {
    const q = new URLSearchParams();
    if (opts.page != null) q.set("page", String(opts.page));
    if (opts.pageSize != null) q.set("pageSize", String(opts.pageSize));
    if (opts.symbol) q.set("symbol", opts.symbol);
    if (opts.fromMs != null) q.set("fromMs", String(opts.fromMs));
    if (opts.toMs != null) q.set("toMs", String(opts.toMs));
    const qs = q.toString();
    return this.req("GET", `/connections/${enc(connectionId)}/trades${qs ? "?" + qs : ""}`);
  }
  /**
   * GET /connections/{id}/trades/{tradeId} — one closed trade WITH its individual fills, oldest
   * first. A trade that does not exist, belongs to another connection, or is hidden by the
   * phantom-spot-short rule all answer the same 404.
   */
  getTrade(connectionId: string, tradeId: number): Promise<ClosedTradeDetail> {
    return this.req("GET", `/connections/${enc(connectionId)}/trades/${tradeId}`);
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

  // ── workspace (supersedes panel control; carries no api-version) ─────────
  // The terminal's WINDOWS, the TABS inside a window, the durable BOXES docked in a tab's layout
  // tree, and the CHART WINDOWS floating beside them. A tab's `layout` is the very tree the panel
  // surface serves, so the node and content types are shared.
  //
  // One wire rule: `kind` must be the FIRST key of a content object — the terminal resolves the
  // write union by a discriminator it reads first. These methods pin it; a hand-built body must.

  /** GET /app/workspace — every window with its tabs, layouts and chart windows. Scope with `windowId` / `tabId`. */
  getWorkspace(opts: { windowId?: string; tabId?: string } = {}): Promise<WorkspaceWindow[]> {
    const q = new URLSearchParams();
    if (opts.windowId) q.set("windowId", opts.windowId);
    if (opts.tabId) q.set("tabId", opts.tabId);
    const qs = q.toString();
    return this.req<{ windows: WorkspaceWindow[] }>("GET", `/app/workspace${qs ? "?" + qs : ""}`).then((r) => r.windows);
  }

  /** GET /app/windows — the windows without any tab payload (`tabCount` instead of the tabs). */
  listWindows(): Promise<WindowSummary[]> {
    return this.req<{ windows: WindowSummary[] }>("GET", "/app/windows").then((r) => r.windows);
  }

  /** PATCH /app/windows/{windowId} — raise a window to the front. Only `{active: true}` is meaningful. */
  activateWindow(windowId: string): Promise<WindowAction> {
    return this.req("PATCH", `/app/windows/${enc(windowId)}`, { active: true });
  }

  /**
   * POST /app/tabs → 201. Omit `windowId` for the main window, `title` for the automatic coin +
   * count label, `index` to append. The new tab has no `layout` until something is added to it;
   * `activate` surfaces it (default false so a background tool never steals focus).
   */
  createTab(body: CreateTabBody = {}): Promise<TabAction> {
    return this.req("POST", "/app/tabs", body);
  }

  /** GET /app/tabs/{tabId} — the tab, byte-identical to its node in the workspace, plus where it sits. */
  getTab(tabId: string): Promise<TabLookup> {
    return this.req("GET", `/app/tabs/${enc(tabId)}`);
  }

  /**
   * PATCH /app/tabs/{tabId} — rename, reorder and/or activate in one call (applied title → index →
   * active). `title` is tri-state: a string renames, `null` CLEARS back to the automatic label, and
   * OMITTING the key leaves the name alone. The terminal reads the key rather than the value, so
   * never pass a title you read back from {@link getTab} — that freezes a rendered label such as
   * `"BTC (3)"` as a permanent custom name.
   */
  updateTab(tabId: string, patch: UpdateTabBody): Promise<TabAction> {
    return this.req("PATCH", `/app/tabs/${enc(tabId)}`, patch);
  }

  /**
   * DELETE /app/tabs/{tabId} — its slots, feeds and floating chart windows close with it. Closing
   * the last tab of a BOOK window closes the window; closing the last tab of the MAIN window is
   * refused (409 `last_tab`).
   */
  closeTab(tabId: string): Promise<TabRemoved> {
    return this.req("DELETE", `/app/tabs/${enc(tabId)}`);
  }

  /**
   * POST /app/slots → 201. ADDS boxes — `target` names an ANCHOR that survives with its id, its
   * content and its live feed; it is never replaced. `target` is `{slot, side}` or `{edge}`, never
   * both (default `{edge: "right"}`); `stack` is how the new boxes arrange among THEMSELVES.
   * `share` lives on each {@link NewSlot}, not inside its content.
   */
  addSlots(body: AddSlotsBody): Promise<SlotsAdded> {
    const slots = body.slots.map((s) => ({ ...s, content: kindFirst(s.content) }));
    return this.req("POST", "/app/slots", { ...body, slots });
  }

  /** GET /app/slots/{slotId} — the box and where it sits (window, tab, the index chain, its parent split). */
  getSlot(slotId: string): Promise<WorkspaceSlotLookup> {
    return this.req("GET", `/app/slots/${enc(slotId)}`);
  }

  /**
   * PUT /app/slots/{slotId} — declare what THIS box holds. Idempotent, a kind transition is legal,
   * and the slot id never changes. `content` is REQUIRED here, unlike the deprecated
   * {@link setPanel} where omitting it cleared the box — use {@link clearSlot} for that. Every set
   * on a WIDGET box is refused (409), a clear included.
   */
  setSlot(slotId: string, content: SettableContent): Promise<SlotChanged> {
    return this.req("PUT", `/app/slots/${enc(slotId)}`, { content: kindFirst(content) });
  }

  /** Clear the box — it stays on screen and keeps its id and its position. */
  clearSlot(slotId: string): Promise<SlotChanged> {
    return this.setSlot(slotId, { kind: "empty" });
  }

  /** DELETE /app/slots/{slotId} — structural: the box is gone and its id retired. A chart paired under an orderbook goes with it. */
  removeSlot(slotId: string): Promise<SlotRemoved> {
    return this.req("DELETE", `/app/slots/${enc(slotId)}`);
  }

  /** GET /app/chart-windows — the floating chart windows, each carrying the `tabId` that owns it. */
  listChartWindows(opts: { tabId?: string; kind?: ChartWindowKind } = {}): Promise<ChartWindow[]> {
    const q = new URLSearchParams();
    if (opts.tabId) q.set("tabId", opts.tabId);
    if (opts.kind) q.set("kind", opts.kind);
    const qs = q.toString();
    return this.req<{ chartWindows: ChartWindow[] }>("GET", `/app/chart-windows${qs ? "?" + qs : ""}`).then(
      (r) => r.chartWindows,
    );
  }

  /**
   * POST /app/chart-windows → **200 or 201**. 201 opened a window; 200 means that `(kind, exchange,
   * symbol)` was already open and the live window was re-homed and shown — not an error, and not a
   * new window. `interval` is `chart` only, `intervals` (exactly 3) `comboChart` only.
   */
  openChartWindow(body: OpenChartWindowBody): Promise<ChartWindowAction> {
    return this.req("POST", "/app/chart-windows", body);
  }

  /**
   * PATCH /app/chart-windows/{chartWindowId} — retarget, re-interval, re-home, pin, lock or raise.
   * `sync` is exclusive across combo windows and the answer reports only THIS window, so re-read
   * {@link listChartWindows} to see what it turned off.
   */
  updateChartWindow(chartWindowId: string, patch: UpdateChartWindowBody): Promise<ChartWindowAction> {
    return this.req("PATCH", `/app/chart-windows/${enc(chartWindowId)}`, patch);
  }

  /** DELETE /app/chart-windows/{chartWindowId} — close it. */
  closeChartWindow(chartWindowId: string): Promise<ChartWindowRemoved> {
    return this.req("DELETE", `/app/chart-windows/${enc(chartWindowId)}`);
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
