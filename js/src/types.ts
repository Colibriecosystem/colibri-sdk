// Colibri Local API — wire types.
// Every price / size / quantity is a decimal STRING (crypto tick precision is lost through JSON floats).

export interface Ping {
  name: string;
  version: string;
  /** The Local API protocol version (currently 1) — what an UNVERSIONED request gets. */
  apiVersion: number;
  /** The live bound port (useful when the preferred port was taken). */
  port: number;
  /**
   * Every response-shape version the `api-version` header may select (absent on a terminal that
   * predates versioning — read that as `[1]`). This SDK sends {@link API_VERSION}.
   */
  supportedApiVersions?: number[];
}

/**
 * The response-shape version this SDK is written against, sent as the `api-version` header on
 * every call. Today only the `/app/panels` family has two shapes; every other route ignores it. A
 * terminal that predates v2 ignores the header and answers v1 — so this SDK needs a terminal that
 * serves v2 (check `supportedApiVersions` on `/ping`). From terminal 1.3.0 v1 is removed and the
 * header is ignored.
 */
export const API_VERSION = 2;

export interface BookLevel {
  price: string;
  baseQty: string;
  usdVolume: string;
}

export interface Book {
  exchange: string;
  symbol: string;
  tickSize: string;
  lastPrice: string;
  bestBid: string | null;
  bestAsk: string | null;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface ClusterLevel {
  price: string;
  buyUsd: string;
  sellUsd: string;
  buyBase: string;
  sellBase: string;
}

/** One 15-second base footprint bucket (the client merges buckets into coarser timeframes itself). */
export interface Cluster {
  /** Bucket start time, unix SECONDS. */
  startUnixSec: number;
  totalBuyUsd: string;
  totalSellUsd: string;
  totalBuyBase: string;
  totalSellBase: string;
  levels: ClusterLevel[];
}

export interface Clusters {
  exchange: string;
  symbol: string;
  tickSize: string;
  /** Raw 15-second base buckets, oldest → newest. */
  buckets: Cluster[];
}

export interface Funding {
  exchange: string;
  symbol: string;
  rate: string;
  nextFundingTimeMs: number;
}

export interface SymbolInfo {
  symbol: string;
  name: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: string;
  stepSize: string;
}

export interface Connection {
  id: string;
  exchange: string;
  marketType: string;
  label: string;
  demo: boolean;
  viewOnly: boolean;
  apiTradingEnabled: boolean;
}

export interface Position {
  symbol: string;
  exchange: string;
  side: string;
  quantity: string;
  entryPrice: string;
}

export interface Order {
  clientOrderId: string;
  exchangeOrderId: string | null;
  symbol: string;
  exchange: string;
  side: string;
  type: string;
  status: string;
  price: string;
  quantity: string;
  filledQuantity: string;
}

export interface Balance {
  asset: string;
  free: string;
  locked: string;
}

export type Side = "BUY" | "SELL";
export type OrderType = "Limit" | "Market";

/**
 * A place-order request (`POST /connections/{id}/orders`). The connection — and therefore the
 * venue — is the URL, so the body carries neither. Give EITHER {@link sizeQuote} (spend N quote /
 * USDT) OR {@link sizeBase} (N coins). `price` is required for Limit and must be ABSENT for
 * Market. `reduceOnly` closes a position. The order routes through the SAME path a terminal click
 * uses (per-connection trading grant required).
 */
export interface PlaceOrder {
  symbol: string;
  side: Side;
  type: OrderType;
  price?: string;
  sizeQuote?: string;
  sizeBase?: string;
  reduceOnly?: boolean;
}

export interface OrderAccepted {
  clientOrderId: string;
  status: string;
}

/** All-granted sweep result (`DELETE /orders` / `DELETE /positions`). */
export interface SweepResult {
  status: string;
  /** How many granted accounts the action was dispatched to. */
  accounts: number;
}

/** Request direction values; responses echo the enum NAME (`"Above"` / `"Below"` / `"Cross"`). */
export type SignalDirection = "above" | "below" | "cross";

/**
 * One API-owned price alert. Lifecycle: a level fires AT MOST ONCE. `oneShot: true` → removed
 * after firing; `oneShot: false` (default) → kept, marked `isTriggered` + `triggeredMs` (sweep
 * them with `DELETE /signal-levels/triggered`).
 */
export interface SignalLevel {
  id: string;
  exchange: string;
  symbol: string;
  price: string;
  /** Enum name: "Above" | "Below" | "Cross". */
  direction: string;
  note: string | null;
  oneShot: boolean;
  createdMs: number;
  /** true once the level has fired (non-one-shot levels only). */
  isTriggered: boolean;
  /** Fire time, unix ms; null while untriggered. */
  triggeredMs: number | null;
}

export interface TradePush {
  price: string;
  qty: string;
  isBuy: boolean;
  timeMs: number;
}

/**
 * The curated orderbook-settings slice (exchange tier of the terminal's settings cascade).
 * GET returns every field set (effective values); PATCH takes any subset — only the fields
 * present change. Decimals are strings; enums are their names.
 */
export interface OrderbookSettings {
  sizeUnit?: string | null;
  depthUnit?: string | null;
  minTradeUsd?: number | null;
  minTradeBase?: string | null;
  tickWindowMs?: number | null;
  volumeBarThresholdUsd?: number | null;
  largeVolumeUsd?: number | null;
  largeVolume2Usd?: number | null;
  clusterFillThresholdUsd?: number | null;
  aggregationMode?: string | null;
  aggregationDefaultValue?: string | null;
  showTicks?: boolean | null;
  showLiquidations?: boolean | null;
  stopLossPercent?: string | null;
  ocoEnabled?: boolean | null;
  ocoTakeProfitPercent?: string | null;
  ocoStopLossPercent?: string | null;
}

// ── Slot control (/app/panels, api-version 2) ────────────────────────────────
// A SLOT is the durable box — addressed by its GUID `id`, which survives an instrument change, a
// clear, a kind transition, and a terminal restart. A tab is ONE layout tree: a node is a `split`
// (children side by side = `row`, stacked = `column`) or a `slot`, and a leaf IS the slot. What
// fills a slot is a union on `kind` carrying only the fields that mean something for that kind.
// Copy an id from the terminal: the ⧉ control on a panel, or right-click a tab header → "Copy tab
// ID" for the POST add-target.

/** A split: children laid out side by side (`row`) or stacked (`column`). */
export interface SplitNode {
  type: "split";
  orientation: "row" | "column";
  /** This node's fraction of its parent; absent on the tab root (which has no parent). */
  share?: number;
  children: LayoutNode[];
}

/** A slot — the durable box (`id` is the op key for set / clear / remove) with what fills it. */
export interface SlotNode {
  type: "slot";
  id: string;
  /** This node's fraction of its parent; absent on a root slot and on action responses. */
  share?: number;
  content: SlotContent;
}

export type LayoutNode = SplitNode | SlotNode;

/** The "+" placeholder — a box you may fill. */
export interface EmptyContent {
  kind: "empty";
}

export interface OrderbookContent {
  kind: "orderbook";
  exchange: string;
  symbol: string;
  /** The per-instrument panel id — changes on a re-pick, unlike the slot `id`. */
  contentId: string;
  /** The bound trading account — present only when one is bound. */
  connectionId?: string;
  /** true = no trading through this box (no account, or trading disabled on it). */
  viewOnly: boolean;
}

export interface ChartContent {
  kind: "chart";
  exchange: string;
  symbol: string;
  /** The chart timeframe (e.g. `M1`, `M5`). */
  interval: string;
  contentId: string;
}

/** A widget box. The API can SEE one; it never starts or stops one (every write to it is `409`). */
export interface WidgetContent {
  kind: "widget";
  widgetId: string;
  /** The widget instance id — the same value that widget's own handshake carries. */
  contentId: string;
  name: string;
  /** false = the not-installed / revoked placeholder that still holds the box. */
  installed: boolean;
}

/** What a slot holds — discriminated on `kind`. `contentId` is UNIFORM across the filled kinds. */
export type SlotContent = EmptyContent | OrderbookContent | ChartContent | WidgetContent;

/** One tab, keyed by its durable `id` — the `tabId` an add targets. */
export interface PanelTab {
  id: string;
  /** Positional index within the window. */
  index: number;
  /** Whether this is the tab its window shows. */
  active: boolean;
  /** The header label as rendered (the custom name, else the automatic coin + count). */
  title: string;
  /** The whole layout tree; a single-box tab has a `SlotNode` root. Null for a never-laid-out tab. */
  layout: LayoutNode | null;
}

/** One window, keyed by position (durable window ids are a later addition). */
export interface PanelWindow {
  /** 0 = the main window. */
  index: number;
  /** Whether this is the OS-active window. */
  active: boolean;
  tabs: PanelTab[];
}

/** Where one slot sits, relative to its tab's root. */
export interface SlotPosition {
  window: number;
  /** The tab's durable id. */
  tab: string;
  /** The index chain from the tab root; empty for a root slot. */
  path: number[];
  depth: number;
  /** The parent split; absent for a root slot (a single-box tab). */
  parent?: { orientation: "row" | "column"; index: number; count: number };
}

/** `GET /app/panels/{id}` — the slot exactly as its leaf in the tree, plus where it sits. */
export interface SlotLookup {
  slot: SlotNode;
  position: SlotPosition;
}

/**
 * One content to place — the read side's union minus the ids the terminal mints. A widget is
 * never placed through the API. `share` (0–1, exclusive) sizes the box within a stack.
 */
export type PlaceableContent =
  | { kind: "orderbook"; exchange: string; symbol: string; connectionId?: string; share?: number }
  | { kind: "chart"; exchange: string; symbol: string; interval?: string; share?: number };

/**
 * The legacy one-instrument-plus-`views` form (still accepted): `views` is `["orderbook"]`,
 * `["chart"]`, or `["orderbook","chart"]` (the pair — chart stacked under the orderbook, same
 * instrument, app-default timeframe). Prefer {@link PlaceableContent}.
 */
export interface PanelContent {
  connectionId?: string;
  exchange: string;
  symbol: string;
  views: ("orderbook" | "chart")[];
}

/** Where a stack lands: beside `slotId` on `side`, using the drag-drop `action` vocabulary (default `pair`). */
export interface PanelTarget {
  slotId: string;
  side?: "left" | "right" | "top" | "bottom";
  action?: "pair" | "row" | "column" | "intoRow";
}

/** `POST /app/panels` — an ordered STACK of boxes (`contents`), or the legacy single `content`. */
export interface AddPanelsBody {
  /** Target tab (durable id); omitted = the ACTIVE tab. */
  tabId?: string;
  /** Each item its own box, in order (at most 16). Mutually exclusive with `content`. */
  contents?: PlaceableContent[];
  /** Where the stack lands; omitted = appended to the tab's root row. */
  target?: PanelTarget;
  /** How the items stack relative to each other (default `column`). */
  orientation?: "row" | "column";
  /** ONE content (`PlaceableContent`, `{kind:"empty"}` = a bare "+" box) or the legacy `views` form. */
  content?: PlaceableContent | EmptyContent | PanelContent | null;
  /** Surface the terminal window afterwards (default false so a background tool never steals focus). */
  activate?: boolean;
}

/** Result of an add / set / clear / remove — the affected box(es) in the tree's own leaf shape. */
export interface SlotAction {
  /** `added` (POST) / `ok` (PUT) / `removed` (DELETE). */
  status: string;
  /** The primary (first) box. */
  slot?: SlotNode;
  /** Every box a stack add created, in request order. */
  slots?: SlotNode[];
}

/** @deprecated Use {@link SlotAction} — the v1 name, kept as an alias for one release. */
export type PanelActionResult = SlotAction;

/** One venue from GET /exchanges — `id` is the string every `exchange` param accepts. */
export interface ExchangeInfo {
  id: string;
  name: string;
  marketType: string;
  /** false = market-data-only venue (no trading surface). */
  trading: boolean;
}

/** Live WebSocket channels on `/stream`. */
export type Channel =
  | "book"
  | "trades"
  | "funding"
  | "positions"
  | "orders"
  | "balance"
  | "notifications"
  | "signalLevels";

/** Subscription params — market channels use exchange+symbol, account channels use connectionId. */
export interface SubscribeParams {
  exchange?: string;
  symbol?: string;
  connectionId?: string;
  /** `book`: desired frames per second (server-capped at 10). */
  hz?: number;
  /** `book`: levels per side (server-capped at 500). */
  depth?: number;
}
