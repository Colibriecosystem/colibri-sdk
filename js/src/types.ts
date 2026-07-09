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
