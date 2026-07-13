// Colibri Local API — wire types.
// Every price / size / quantity is a decimal STRING (crypto tick precision is lost through JSON floats).

export interface Ping {
  name: string;
  version: string;
  apiVersion: string;
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

export interface Cluster {
  startMs: number;
  levels: ClusterLevel[];
}

export interface Clusters {
  exchange: string;
  symbol: string;
  tickSize: string;
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
export type OrderType = "LIMIT" | "MARKET";

/**
 * A place-order request. Give EITHER {@link sizeQuote} (spend N quote / USDT) OR {@link sizeBase}
 * (N coins). `price` is required for LIMIT and omitted for MARKET. `reduceOnly` closes a position.
 * The order routes through the SAME path a terminal click uses (per-connection trading grant required).
 */
export interface PlaceOrder {
  connectionId: string;
  exchange: string;
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

export type SignalDirection = "above" | "below" | "cross";

export interface SignalLevel {
  id: string;
  exchange: string;
  symbol: string;
  price: string;
  direction: SignalDirection;
  note: string | null;
  oneShot: boolean;
  createdMs: number;
}

export interface TradePush {
  price: string;
  qty: string;
  isBuy: boolean;
  timeMs: number;
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

/** One desired content item; content[0] must be the orderbook. */
export interface PanelContent {
  kind: "orderbook" | "chart";
  exchange: string;
  symbol: string;
  /** Chart timeframe, e.g. "m5" — chart items only. */
  interval?: string;
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
  /** Snapshot channels (book/clusters): desired frames per second; the server caps it. */
  hz?: number;
  depth?: number;
  limit?: number;
}
