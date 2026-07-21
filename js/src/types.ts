// Colibri Local API — wire types.
// Every price / size / quantity is a decimal STRING (crypto tick precision is lost through JSON floats).

export interface Ping {
  name: string;
  version: string;
  /** The Local API protocol version (currently 1). */
  apiVersion: number;
  /** The live bound port (useful when the preferred port was taken). */
  port: number;
}

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

// ── Slot control (/app/panels) ────────────────────────────────────────────────
// A SLOT is the durable box — addressed by its GUID `slotId`, which survives an instrument change,
// a clear, and a terminal restart. A PANEL is the content that fills it (an orderbook, optionally
// paired with a chart). Copy an id from the terminal: the ⧉ control on a panel, or right-click a
// tab header → "Copy tab ID" for the POST add-target.

/** The chart paired into a slot's column (content[1]). */
export interface PanelChart {
  exchange: string;
  symbol: string;
  interval: string;
  contentId: string;
}

/** One slot in the tree. `slotId` is the durable op key; `contentId` is the per-instrument id. */
export interface PanelSlot {
  slotId: string;
  kind: "orderbook" | "chart" | "empty";
  empty: boolean;
  exchange: string | null;
  symbol: string | null;
  contentId: string | null;
  /** The bound trading account; null = view-only. */
  connectionId: string | null;
  viewOnly: boolean;
  chart: PanelChart | null;
}

/** One tab, keyed by its durable `uuid` — the add target for POST /app/panels. */
export interface PanelTab {
  uuid: string;
  index: number;
  slots: PanelSlot[];
}

/** One window, keyed by position (durable window ids are a later addition). */
export interface PanelWindow {
  index: number;
  tabs: PanelTab[];
}

/**
 * The desired content of a slot: ONE instrument + the views that render it.
 * `views`: `["orderbook"]`, `["chart"]` (a standalone chart slot), or `["orderbook","chart"]`
 * (the pair — chart stacked under the orderbook, same instrument, app-default timeframe).
 * `connectionId` binds a trading account (grant-gated; requires the orderbook view); omitted =
 * the app adopts the venue's default connection by itself.
 */
export interface PanelContent {
  connectionId?: string;
  exchange: string;
  symbol: string;
  views: ("orderbook" | "chart")[];
}

/** One venue from GET /exchanges — `id` is the string every `exchange` param accepts. */
export interface ExchangeInfo {
  id: string;
  name: string;
  marketType: string;
  /** false = market-data-only venue (no trading surface). */
  trading: boolean;
}

/** Result of an add / set / remove — the status plus the affected slot. */
export interface PanelActionResult {
  status: string;
  panel: PanelSlot | null;
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
