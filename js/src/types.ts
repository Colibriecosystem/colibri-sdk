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
 * serves v2 (check `supportedApiVersions` on `/ping`). From terminal 1.4.0 v1 is removed and the
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
  /** `"slot"` on the workspace surface; absent on the deprecated `/app/panels` reads, which never send it. */
  surface?: "slot";
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

/** The parent split of a slot: its axis, the slot's index among its siblings, how many there are. */
export interface SlotParent {
  orientation: "row" | "column";
  index: number;
  count: number;
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
  parent?: SlotParent;
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

// ── workspace (supersedes panels; no api-version — every route in it is new) ──────────────
// The terminal's windows, the TABS inside a window, the BOXES docked in a tab's layout tree, and
// the CHART WINDOWS that float beside them. A tab's `layout` is the same tree the panel surface
// serves, so `LayoutNode` / `SplitNode` / `SlotNode` / `SlotContent` are shared verbatim.
//
// The one wire rule this surface adds: in a content object `kind` must be the FIRST key. The
// terminal resolves the write union by a discriminator it expects to read first, and a content
// that leads with anything else fails the parse rather than answering a 400. The client methods
// pin it for you; a hand-built body must do the same.

/** An edge — where new boxes go. Not {@link Side}, which is an ORDER side; two vocabularies. */
export type SlotSide = "left" | "right" | "top" | "bottom";

/** The singleton main window, or one of zero-or-more book windows. */
export type WindowKind = "main" | "book";

/** A standalone chart window, or the 3-pane / 3-timeframe combo chart window. */
export type ChartWindowKind = "chart" | "comboChart";

/**
 * A window rectangle. When `maximized` is true this is the last NON-maximized position — where the
 * window un-maximizes to, not where it sits on screen. The two are meaningless apart.
 */
export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** A floating chart window on ONE timeframe. */
export interface SingleChartWindow {
  surface: "window";
  kind: "chart";
  id: string;
  /** Present when the window was listed; absent when nested under its own tab, whose position already says it. */
  tabId?: string;
  exchange: string;
  symbol: string;
  interval: string;
  /** The chart's content identity, stable across a restart. */
  contentId: string;
  bounds: Bounds;
  /** Always-on-top above Colibri's own windows. New windows default ON. */
  pinned: boolean;
  /** OS always-on-top, above every application. New windows default OFF. */
  locked: boolean;
}

/**
 * One symbol across THREE timeframe panes. It has three panes and so no single content identity,
 * which is why it carries no `contentId`.
 */
export interface ComboChartWindow {
  surface: "window";
  kind: "comboChart";
  id: string;
  tabId?: string;
  exchange: string;
  symbol: string;
  /** Exactly three timeframes. */
  intervals: [string, string, string];
  bounds: Bounds;
  pinned: boolean;
  locked: boolean;
  /** Follow-the-clicked-orderbook. EXCLUSIVE across combo windows — enabling it disables every other. */
  sync: boolean;
}

/** A floating chart window — narrow it with `w.kind === "comboChart"`. */
export type ChartWindow = SingleChartWindow | ComboChartWindow;

/** One tab of the workspace, keyed by its durable `id`. */
export interface WorkspaceTab {
  id: string;
  /** Positional index within its window. */
  index: number;
  /** Whether it is the tab its window currently shows. */
  active: boolean;
  /**
   * The label the header actually RENDERS — the user's name when the tab has one, else the sticky
   * first coin plus a panel count (`"BTC (3)"`), else `""`. Writing a rendered label back through
   * {@link UpdateTabBody} freezes it, count suffix and all, as a permanent custom name.
   */
  title: string;
  /** The whole layout tree; absent on a tab that has never been laid out. */
  layout?: LayoutNode;
  /** The floating chart windows this tab owns. Always present, empty when it owns none. */
  windows: ChartWindow[];
}

/** One window with its whole tab payload. */
export interface WorkspaceWindow {
  id: string;
  /** Position. The main window is always 0. */
  index: number;
  kind: WindowKind;
  active: boolean;
  bounds: Bounds;
  locked: boolean;
  tabs: WorkspaceTab[];
}

/** One window WITHOUT its tab payload — `tabCount` instead of the tabs themselves. */
export interface WindowSummary {
  id: string;
  index: number;
  kind: WindowKind;
  active: boolean;
  bounds: Bounds;
  locked: boolean;
  tabCount: number;
}

/** Which window a tab sits in, and where. */
export interface TabPosition {
  windowId: string;
  windowIndex: number;
  tabCount: number;
}

/** `GET /app/tabs/{tabId}` — the tab, byte-identical to its node in the workspace, plus where it sits. */
export interface TabLookup {
  tab: WorkspaceTab;
  position: TabPosition;
}

/** The answer to a tab create / update. */
export interface TabAction {
  status: "created" | "changed";
  tab: WorkspaceTab;
  position: TabPosition;
}

/** The answer to a window activate. */
export interface WindowAction {
  status: "changed";
  window: WindowSummary;
}

/** The answer to a tab close. */
export interface TabRemoved {
  status: "removed";
  tabId: string;
}

/** `POST /app/tabs` — every field optional. */
export interface CreateTabBody {
  /** Absent: the main window. */
  windowId?: string;
  /** Absent: the automatic coin + count label. */
  title?: string;
  /** Absent: append. */
  index?: number;
  /** A background tool never steals focus, so this defaults to false. */
  activate?: boolean;
}

/** `PATCH /app/tabs/{tabId}` — name at least one field; applied title → index → active. */
export interface UpdateTabBody {
  /**
   * A string RENAMES; `null` CLEARS back to the automatic label; OMITTING the key leaves the name
   * alone. The terminal reads the KEY, not the value, so a body carrying `title: null` clears the
   * name and still answers 200 — never fill this in from a read you are round-tripping.
   */
  title?: string | null;
  /** Reorder within the tab's own window. */
  index?: number;
  /** Only `true` is meaningful; there is no "unfocus this tab". */
  active?: true;
  /** Activating a tab in a background window surfaces that window too (default true). */
  raiseWindow?: boolean;
}

/**
 * Where new boxes go: beside an anchor box (`slot` + `side`) or at the tab's edge (`edge`) — NEVER
 * both, and `side` may not travel without `slot`. Absent means `{ edge: "right" }`.
 *
 * There is deliberately no "mode": how the room is found next to an anchor is decided by the side
 * and the two content kinds, not by the caller.
 */
export type SlotTarget =
  | {
      /** The ANCHOR box. It survives, smaller — it is never replaced. */
      slot: string;
      /** REQUIRED with `slot`, never defaulted — it decides the structural outcome. */
      side: SlotSide;
      edge?: never;
    }
  | {
      /** `left`/`right`: a full-height column. `top`/`bottom`: a full-width row. */
      edge: SlotSide;
      slot?: never;
      side?: never;
    };

/**
 * One content to place on this surface — {@link PlaceableContent} minus `share`, which lives on the
 * {@link NewSlot} here rather than inside the content (a `share` written inside a content is
 * silently dropped). A widget is never placed (400).
 */
export type NewSlotContent =
  | { kind: "orderbook"; exchange: string; symbol: string; connectionId?: string }
  | { kind: "chart"; exchange: string; symbol: string; interval?: string };

/** One box to create. */
export interface NewSlot {
  /**
   * This box's fraction (0–1, exclusive). Converted PER INSERTION — a list nests as it is inserted,
   * so the i-th box asks for a fraction of what is LEFT. Omitted = an even split; values clamp into
   * 0.05–0.95.
   */
  share?: number;
  content: NewSlotContent;
}

/** `POST /app/slots` — ADDS boxes; the anchor is never replaced. */
export interface AddSlotsBody {
  /** Absent: the active tab of the main window. */
  tabId?: string;
  /** Absent: `{ edge: "right" }`. */
  target?: SlotTarget;
  /** How the NEW boxes arrange among themselves (default `column`). Ignored for a single box. */
  stack?: "row" | "column";
  /** At most 16 — the per-widget panel cap charges one token per REQUEST. */
  slots: NewSlot[];
  /** True also surfaces the window (default false). */
  activate?: boolean;
}

/**
 * What a box may be SET to — a placeable content, or `{kind:"empty"}` to clear it (the box stays
 * and keeps its id). Deliberately wider than the add union: POSTing an empty box as part of a stack
 * is refused, because a stack inserts CONTENT.
 */
export type SettableContent = NewSlotContent | EmptyContent;

/** The answer to an add — every box it made, in request order, each in the tree's own leaf shape. */
export interface SlotsAdded {
  status: "added";
  slots: SlotNode[];
}

/** The answer to a set — THIS box only. */
export interface SlotChanged {
  status: "changed";
  slot: SlotNode;
}

/** The answer to a remove — the box is gone and its id retired. */
export interface SlotRemoved {
  status: "removed";
  slotId: string;
}

/**
 * Where one box sits on the workspace surface. Not {@link SlotPosition}: that one keys its window by
 * INDEX and spells the tab `tab`; this one carries durable string ids for both.
 */
export interface WorkspaceSlotPosition {
  windowId: string;
  tabId: string;
  /** The index chain from the tab root. */
  path: number[];
  depth: number;
  /** ABSENT exactly when the slot is a root — a single-box tab. */
  parent?: SlotParent;
}

/** `GET /app/slots/{slotId}` — the box and where it sits. */
export interface WorkspaceSlotLookup {
  slot: SlotNode;
  position: WorkspaceSlotPosition;
}

/** The answer to a chart-window open / update. `opened` is new; `changed` is a deduped one re-homed. */
export interface ChartWindowAction {
  status: "opened" | "changed";
  chartWindow: ChartWindow;
}

/** The answer to a chart-window close. */
export interface ChartWindowRemoved {
  status: "removed";
  chartWindowId: string;
}

/** `POST /app/chart-windows` — the dedupe key is (`kind`, `exchange`, `symbol`). */
export interface OpenChartWindowBody {
  kind: ChartWindowKind;
  exchange: string;
  symbol: string;
  /** `chart` only — refused on `comboChart`. Absent: the app default (M5). */
  interval?: string;
  /** `comboChart` only — refused on `chart`. Absent: M5 / M15 / H1. */
  intervals?: [string, string, string];
  /** The owning tab. Absent: the active tab of the main window. */
  tabId?: string;
  activate?: boolean;
}

/** `PATCH /app/chart-windows/{chartWindowId}` — name at least one field. */
export interface UpdateChartWindowBody {
  exchange?: string;
  symbol?: string;
  /** `chart` only. */
  interval?: string;
  /** `comboChart` only. */
  intervals?: [string, string, string];
  /** Re-home to another tab. */
  tabId?: string;
  pinned?: boolean;
  locked?: boolean;
  /** `comboChart` only, and EXCLUSIVE: the answer reports only THIS window, so re-read the list to see the others. */
  sync?: boolean;
  /** Raise it. Only `true` is meaningful. */
  active?: true;
}

// ── closed trades ────────────────────────────────────────────────────────
/**
 * One CLOSED position — a history row, not a live tape print (that is {@link TradePush}). Every
 * money and size field is a decimal string; JSON floats lose crypto tick precision. A row is
 * AMENDABLE after it is written, so a poller should re-read rather than cache.
 */
export interface ClosedTrade {
  id: number;
  exchange: string;
  symbol: string;
  side: "Long" | "Short";
  openPrice: string;
  closePrice: string;
  quantity: string;
  volumeUsd: string;
  netPnl: string;
  /** RECOMPUTED from `netPnl` + `commission` over `volumeUsd` — rows written before the fix stored a percent with commission already folded in. */
  pnlPercent: string;
  commission: string;
  funding: string;
  openTimeMs: number;
  closeTimeMs: number;
}

/** `GET /connections/{id}/trades` — one page, newest CLOSE first. */
export interface ClosedTradesPage {
  connectionId: string;
  trades: ClosedTrade[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/** One venue fill that makes up a closed trade. */
export interface ClosedTradeFill {
  price: string;
  quantity: string;
  quoteQuantity: string;
  commission: string;
  isBuyer: boolean;
  timeMs: number;
  venueTradeId: string;
}

/** `GET /connections/{id}/trades/{tradeId}` — one closed trade with its fills, oldest first. */
export interface ClosedTradeDetail {
  connectionId: string;
  trade: ClosedTrade;
  fills: ClosedTradeFill[];
}

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
