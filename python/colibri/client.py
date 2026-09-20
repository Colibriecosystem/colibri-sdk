"""REST client for the Colibri Local API (zero-dependency — stdlib urllib)."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class ColibriError(Exception):
    """Carries the API's ``{code, message}`` (or the HTTP status when there is no envelope)."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"[{status} {code}] {message}")
        self.status = status
        self.code = code


# The response-shape version this SDK is written against, sent as the ``api-version`` header on
# every call. Today only the ``/app/panels`` family has two shapes; every other route ignores it. A
# terminal that predates v2 ignores the header and answers v1 — so this SDK needs a terminal that
# serves v2 (check ``supportedApiVersions`` on ``/ping``). From terminal 1.4.0 v1 is removed and the
# header is ignored.
API_VERSION = 2


class _Unset:
    """"The caller did not mention this field" — deliberately NOT ``None``.

    Every other optional argument here reads ``None`` as "absent", because the body filter is
    ``{k: v for k, v in body.items() if v is not None}``. A PATCH-shaped field where ``null`` on
    the wire MEANS something — ``title`` on :meth:`ColibriClient.update_tab`, which clears the tab
    back to its automatic label — needs a third value, and this is it.
    """

    __slots__ = ()

    def __repr__(self) -> str:
        return "UNSET"


UNSET = _Unset()


class ColibriClient:
    """
    Talk to a running Colibri terminal over the loopback Local API.

    Reads need no credential at all. **Trading** needs the bearer token AND a per-connection
    grant (Settings -> Program -> Local API). Every price/size on the wire is a decimal STRING.

    >>> ColibriClient(18845)                 # read-only widget: no token
    >>> ColibriClient(18845, token="...")    # can also place / cancel orders
    """

    def __init__(
        self, port: int | str, token: str | None = None, host: str = "127.0.0.1", timeout: float = 10.0
    ) -> None:
        self.base = f"http://{host}:{port}"
        self._token = token or ""
        self._timeout = timeout

    @classmethod
    def discover(cls, host: str = "127.0.0.1", timeout: float = 10.0) -> "ColibriClient":
        """Auto-connect via the discovery file the terminal writes while the API is on.

        Raises ``FileNotFoundError`` when the terminal is closed or the Local API is off.
        A companion tool that runs whether or not the terminal is up should poll
        :meth:`try_discover` instead.
        """
        app_data = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
        path = os.path.join(app_data, "Colibri", "localapi.json")
        with open(path, encoding="utf-8") as fh:
            j = json.load(fh)
        return cls(j["port"], j["token"], host, timeout)

    @classmethod
    def try_discover(cls, host: str = "127.0.0.1", timeout: float = 10.0) -> "ColibriClient | None":
        """Like :meth:`discover`, but returns ``None`` when no terminal is reachable.

        The terminal being closed (or the Local API disabled) is the NORMAL state for a
        companion tool, not an error — so this also swallows a torn/partial discovery file
        (the terminal rewrites it on start). Poll it; connect when it stops returning None.
        """
        try:
            return cls.discover(host, timeout)
        except (OSError, ValueError, KeyError):
            return None

    # ── transport ────────────────────────────────────────────────────────────
    def _req(self, method: str, path: str, body: Any | None = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        # Omitted entirely without a token — open routes take no credential, and a bare
        # "Bearer " is a malformed header rather than "no auth".
        headers = {"Authorization": f"Bearer {self._token}"} if self._token else {}
        # The response-shape version this SDK reads (see API_VERSION). Only /app/panels has two
        # shapes today; every other route ignores it.
        headers["api-version"] = str(API_VERSION)
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            # Always bounded: a plain urlopen() blocks forever, which hangs the caller's
            # worker/UI thread if the terminal is wedged mid-shutdown.
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                text = resp.read().decode()
        except urllib.error.HTTPError as exc:
            text = exc.read().decode()
            # Error bodies are a top-level {code, message}.
            err = json.loads(text) if text else {}
            raise ColibriError(exc.code, err.get("code", f"http_{exc.code}"), err.get("message", text)) from None
        return json.loads(text) if text else None

    @staticmethod
    def _qs(**params: Any) -> str:
        clean = {k: v for k, v in params.items() if v is not None}
        return ("?" + urllib.parse.urlencode(clean)) if clean else ""

    @staticmethod
    def _seg(value: str) -> str:
        """Encode one PATH SEGMENT — ``safe=""`` so a ``/`` inside a symbol is %2F.

        Kraken spells every spot symbol with a slash (``BTC/USDT``, all ~1600 of them);
        interpolated raw it becomes an extra path segment and the API answers
        404 ``Unknown route``. Verified against a live terminal.
        """
        return urllib.parse.quote(value, safe="")

    # ── discovery ────────────────────────────────────────────────────────────
    def ping(self) -> dict:
        """Liveness + version + the live bound port."""
        return self._req("GET", "/ping")

    # ── connections ──────────────────────────────────────────────────────────
    def connections(self) -> list[dict]:
        return self._req("GET", "/connections")["connections"]

    def connection(self, connection_id: str) -> dict:
        return self._req("GET", f"/connections/{urllib.parse.quote(connection_id)}")

    # ── market data ──────────────────────────────────────────────────────────
    def exchanges(self) -> list[dict]:
        """The venue catalog — 'id' is the string every exchange param accepts; trading=False = view-only."""
        return self._req("GET", "/exchanges")["exchanges"]

    def symbols(self, exchange: str) -> list[dict]:
        """GET /exchanges/{exchange}/symbols — the venue's symbol universe."""
        return self._req("GET", f"/exchanges/{urllib.parse.quote(exchange)}/symbols")["symbols"]

    def book(self, exchange: str, symbol: str, depth: int | None = None) -> dict:
        """GET /markets/{exchange}/{symbol}/book — dual-unit snapshot; depth = levels per side (1-500)."""
        return self._req("GET", f"/markets/{self._seg(exchange)}/{self._seg(symbol)}/book" + self._qs(depth=depth))

    def clusters(self, exchange: str, symbol: str, limit: int | None = None) -> dict:
        """GET /markets/{exchange}/{symbol}/clusters — raw 15-second base buckets (merge timeframes yourself); limit 1-17280 (72 h), default 240 = the last hour."""
        return self._req("GET", f"/markets/{self._seg(exchange)}/{self._seg(symbol)}/clusters" + self._qs(limit=limit))

    def funding(self, exchange: str, symbol: str) -> dict:
        """GET /markets/{exchange}/{symbol}/funding — perps only (spot answers 404 'unavailable')."""
        return self._req("GET", f"/markets/{self._seg(exchange)}/{self._seg(symbol)}/funding")

    # ── orderbook settings (exchange tier) ──────────────────────────────────
    def orderbook_settings(self, exchange: str) -> dict:
        """GET /exchanges/{exchange}/orderbook-settings — the EFFECTIVE render settings for the venue."""
        return self._req("GET", f"/exchanges/{urllib.parse.quote(exchange)}/orderbook-settings")

    def patch_orderbook_settings(self, exchange: str, patch: dict) -> dict:
        """PATCH /exchanges/{exchange}/orderbook-settings — partial update: only the fields present change."""
        return self._req("PATCH", f"/exchanges/{urllib.parse.quote(exchange)}/orderbook-settings", patch)

    # ── account (per connection) ─────────────────────────────────────────────
    def positions(self, connection_id: str) -> list[dict]:
        return self._req("GET", f"/connections/{urllib.parse.quote(connection_id)}/positions")["positions"]

    def orders(self, connection_id: str) -> list[dict]:
        return self._req("GET", f"/connections/{urllib.parse.quote(connection_id)}/orders")["orders"]

    def balance(self, connection_id: str) -> list[dict]:
        return self._req("GET", f"/connections/{urllib.parse.quote(connection_id)}/balances")["balances"]

    def list_trades(
        self,
        connection_id: str,
        page: int | None = None,
        page_size: int | None = None,
        symbol: str | None = None,
        from_ms: int | None = None,
        to_ms: int | None = None,
    ) -> dict:
        """GET /connections/{id}/trades — CLOSED-trade history, newest close first.

        from_ms/to_ms bound the CLOSE time and are half-open [from_ms, to_ms); a value the terminal
        cannot parse reads as "not supplied" rather than erroring. page is 1-based, page_size 1-500
        (default 100). A row is AMENDABLE after it is written, so re-read rather than cache.
        Answers {"connectionId", "trades": [...], "page", "pageSize", "totalCount", "totalPages"};
        every money and size field on a trade is a decimal STRING.
        """
        return self._req(
            "GET",
            f"/connections/{urllib.parse.quote(connection_id)}/trades"
            + self._qs(page=page, pageSize=page_size, symbol=symbol, fromMs=from_ms, toMs=to_ms),
        )

    def get_trade(self, connection_id: str, trade_id: int) -> dict:
        """GET /connections/{id}/trades/{tradeId} — one closed trade WITH its fills, oldest first.

        A trade that does not exist, belongs to another connection, or is hidden by the
        phantom-spot-short rule all answer the same 404. Answers
        {"connectionId", "trade": {...}, "fills": [...]}.
        """
        return self._req("GET", f"/connections/{urllib.parse.quote(connection_id)}/trades/{trade_id}")

    # ── trading (per-connection grant required) ──────────────────────────────
    def place_order(
        self,
        connection_id: str,
        symbol: str,
        side: str,
        type: str,  # noqa: A002 - matches the wire field
        price: str | None = None,
        size_quote: str | None = None,
        size_base: str | None = None,
        reduce_only: bool = False,
    ) -> dict:
        """POST /connections/{id}/orders -> 202 {clientOrderId, status}.

        The venue derives from the connection. side = BUY|SELL; type = Limit|Market.
        Give EITHER size_quote (spend N quote) OR size_base (N coins); price for Limit only.
        """
        body = {
            "symbol": symbol,
            "side": side,
            "type": type,
            "price": price,
            "sizeQuote": size_quote,
            "sizeBase": size_base,
            "reduceOnly": reduce_only,
        }
        return self._req(
            "POST",
            f"/connections/{urllib.parse.quote(connection_id)}/orders",
            {k: v for k, v in body.items() if v is not None},
        )

    def cancel_order(self, connection_id: str, client_order_id: str, symbol: str) -> dict:
        """DELETE /connections/{id}/orders/{clientOrderId}?symbol= — cancel one order (symbol required)."""
        return self._req(
            "DELETE",
            f"/connections/{urllib.parse.quote(connection_id)}/orders/{urllib.parse.quote(client_order_id)}"
            + self._qs(symbol=symbol),
        )

    def cancel_all(self, connection_id: str, symbol: str | None = None) -> dict:
        """DELETE /connections/{id}/orders[?symbol=] — bulk cancel: one symbol, or the whole account when omitted."""
        return self._req("DELETE", f"/connections/{urllib.parse.quote(connection_id)}/orders" + self._qs(symbol=symbol))

    def close_positions(self, connection_id: str) -> dict:
        """DELETE /connections/{id}/positions — close every position + cancel leftovers on one connection."""
        return self._req("DELETE", f"/connections/{urllib.parse.quote(connection_id)}/positions")

    def cancel_all_orders(self) -> dict:
        """DELETE /orders — cancel every order on EVERY granted account."""
        return self._req("DELETE", "/orders")

    def close_all_positions(self) -> dict:
        """DELETE /positions — close every position on EVERY granted account."""
        return self._req("DELETE", "/positions")

    # ── app bridge ───────────────────────────────────────────────────────────
    def open_symbol(self, exchange: str, symbol: str, connection_id: str | None = None, views: list[str] | None = None) -> dict:
        """Open ONE coin in the ACTIVE tab + surface the window — a convenience wrapper over
        add_panel(activate=True). connection_id is grant-gated; views default to ["orderbook"]."""
        content: dict[str, Any] = {"exchange": exchange, "symbol": symbol, "views": views or ["orderbook"]}
        if connection_id is not None:
            content["connectionId"] = connection_id
        return self.add_panel(content, activate=True)

    def open_combo(self, symbol: str, target: str = "window") -> dict:
        """POST /app/combos — fan the coin across every connection that lists it. target: tab|window."""
        return self._req("POST", "/app/combos", {"symbol": symbol, "target": target})

    # ── panel control (/app/panels, api-version 2) ───────────────────────────
    # A SLOT is the durable box — its GUID id survives an instrument change, a clear, a kind
    # transition, and a terminal restart. A tab is ONE layout tree: a node is
    #   {"type": "split", "orientation": "row"|"column", "share"?: float, "children": [...]}
    #   {"type": "slot", "id": ..., "share"?: float, "content": {...}}
    # and a leaf IS the slot. content is a union on "kind" carrying only its own fields:
    #   {"kind": "empty"}
    #   {"kind": "orderbook", "exchange", "symbol", "contentId", "connectionId"?, "viewOnly"}
    #   {"kind": "chart", "exchange", "symbol", "interval", "contentId"}
    #   {"kind": "widget", "widgetId", "contentId", "name", "installed"}
    # A content to PLACE is the same minus the ids the terminal mints:
    #   {"kind": "orderbook", "exchange": ..., "symbol": ..., "connectionId"?: ..., "share"?: ...}
    #   {"kind": "chart", "exchange": ..., "symbol": ..., "interval"?: ..., "share"?: ...}
    # connectionId binds a trading account (grant-gated); omitted = the app adopts the venue's
    # default connection by itself. A widget is never placed (400); a widget box refuses every
    # set (409). The legacy {"exchange", "symbol", "views": [...]} form is still accepted.

    def panels(self, tab_id: str | None = None, window_index: int | None = None) -> list[dict]:
        """The window → tab → layout tree, optionally scoped to one tab (durable id) / window (index).

        Each window is {"index", "active", "tabs": [{"id", "index", "active", "title", "layout"}]}.
        """
        return self._req("GET", "/app/panels" + self._qs(tabId=tab_id, windowIndex=window_index))["windows"]

    def panel(self, slot_id: str) -> dict:
        """One slot — byte-identical to its leaf in the tree — plus where it sits.

        Returns {"slot": {...}, "position": {"window", "tab", "path", "depth", "parent"?}} where
        parent = {"orientation", "index", "count"} is present exactly when the slot is not a root.
        """
        return self._req("GET", f"/app/panels/{self._seg(slot_id)}")

    def add_panel(self, content: dict | None = None, tab_id: str | None = None, activate: bool = False) -> dict:
        """Add ONE box to a tab (the ACTIVE tab when tab_id is omitted — right-click a tab header to copy its id).

        content is a placeable content ({"kind": "orderbook"|"chart", ...}); None or
        {"kind": "empty"} adds an EMPTY "+" box instead — reserve now, fill later by its durable id
        via set_panel. activate=True surfaces the terminal window afterwards (default False so a
        background layout tool never steals focus). Answers {"status": "added", "slot": {...}}.
        """
        body: dict[str, Any] = {"tabId": tab_id, "content": content}
        if activate:
            body["activate"] = True
        return self._req("POST", "/app/panels", {k: v for k, v in body.items() if v is not None})

    def add_panels(
        self,
        contents: list[dict],
        tab_id: str | None = None,
        target: dict | None = None,
        orientation: str | None = None,
        activate: bool = False,
    ) -> dict:
        """Add an ordered STACK of boxes (each item its own box, at most 16).

        target = {"slotId": ..., "side"?: "left"|"right"|"top"|"bottom", "action"?: "pair"|"row"|
        "column"|"intoRow"} positions the stack beside an existing slot (omitted = appended to the
        tab's root row); orientation ("row"|"column", default "column") is how the items stack.
        Answers {"status": "added", "slot": <first>, "slots": [<every box, in order>]}.
        """
        body: dict[str, Any] = {"tabId": tab_id, "contents": contents, "target": target, "orientation": orientation}
        if activate:
            body["activate"] = True
        return self._req("POST", "/app/panels", {k: v for k, v in body.items() if v is not None})

    def set_panel(self, slot_id: str, content: dict | None = None) -> dict:
        """Idempotently set what ONE box holds — a kind transition is fine, the id never changes.

        content=None (or {"kind": "empty"}) CLEARS the slot (the box stays and keeps its id). A
        chart docked beside the box is its own box and is left alone. On a widget box every set is
        refused (409). Answers {"status": "ok", "slot": {...}}.
        """
        return self._req("PUT", f"/app/panels/{self._seg(slot_id)}", {"content": content} if content is not None else {})

    def remove_panel(self, slot_id: str) -> dict:
        """Remove the slot entirely (its paired chart goes with it)."""
        return self._req("DELETE", f"/app/panels/{self._seg(slot_id)}")

    # ── workspace (supersedes panel control; carries no api-version) ─────────
    # The terminal's WINDOWS, the TABS inside a window, the durable BOXES docked in a tab's layout
    # tree, and the CHART WINDOWS floating beside them. A tab's "layout" is the very tree the panel
    # surface serves, so the node and content shapes above apply here unchanged.
    #
    #   window  {"id", "index", "kind": "main"|"book", "active", "bounds", "locked", "tabs": [...]}
    #   tab     {"id", "index", "active", "title", "layout"?, "windows": [<chart window>, ...]}
    #   bounds  {"left", "top", "width", "height", "maximized"}  # maximized -> the UN-maximized rect
    #   chart window
    #           {"surface": "window", "kind": "chart", "id", "tabId"?, "exchange", "symbol",
    #            "interval", "contentId", "bounds", "pinned", "locked"}
    #           {"surface": "window", "kind": "comboChart", "id", "tabId"?, "exchange", "symbol",
    #            "intervals": [i1, i2, i3], "bounds", "pinned", "locked", "sync"}
    #
    # A content to PLACE here is {"kind": "orderbook"|"chart"|"empty", ...} WITHOUT "share" — the
    # share lives on the slot ({"share": 0.3, "content": {...}}), and one written inside a content
    # is silently dropped. And "kind" must be the FIRST key of a content object: the terminal
    # resolves the write union by a discriminator it expects to read first, so a content leading
    # with anything else fails the parse rather than answering a 400. These methods pin it.

    @staticmethod
    def _kind_first(content: dict) -> dict:
        """Re-emit a content with ``kind`` first — the order is part of the contract, not style."""
        return {"kind": content["kind"], **content}

    def get_workspace(self, window_id: str | None = None, tab_id: str | None = None) -> list[dict]:
        """GET /app/workspace — every window with its tabs, layouts and chart windows.

        Scope it to one window / one tab with the arguments. Answers the list of windows.
        """
        return self._req("GET", "/app/workspace" + self._qs(windowId=window_id, tabId=tab_id))["windows"]

    def list_windows(self) -> list[dict]:
        """GET /app/windows — the windows without any tab payload ("tabCount" instead of the tabs)."""
        return self._req("GET", "/app/windows")["windows"]

    def activate_window(self, window_id: str) -> dict:
        """PATCH /app/windows/{windowId} — raise a window to the front. Only {"active": true} is meaningful."""
        return self._req("PATCH", f"/app/windows/{self._seg(window_id)}", {"active": True})

    def create_tab(
        self,
        window_id: str | None = None,
        title: str | None = None,
        index: int | None = None,
        activate: bool = False,
    ) -> dict:
        """POST /app/tabs -> 201 — create a tab.

        window_id omitted = the main window; title omitted = the automatic coin + count label;
        index omitted = append. The new tab has no "layout" until something is added to it.
        activate=True surfaces it (default False so a background tool never steals focus).
        Answers {"status": "created", "tab": {...}, "position": {...}}.
        """
        body: dict[str, Any] = {"windowId": window_id, "title": title, "index": index}
        if activate:
            body["activate"] = True
        return self._req("POST", "/app/tabs", {k: v for k, v in body.items() if v is not None})

    def get_tab(self, tab_id: str) -> dict:
        """GET /app/tabs/{tabId} — the tab, byte-identical to its node in the workspace, plus where it sits.

        Answers {"tab": {...}, "position": {"windowId", "windowIndex", "tabCount"}}.
        """
        return self._req("GET", f"/app/tabs/{self._seg(tab_id)}")

    def update_tab(
        self,
        tab_id: str,
        title: str | None | _Unset = UNSET,
        index: int | None = None,
        active: bool | None = None,
        raise_window: bool | None = None,
    ) -> dict:
        """PATCH /app/tabs/{tabId} — rename, reorder and/or activate (applied title -> index -> active).

        title is TRI-STATE, and the default is the safe one:
          * UNSET (omitted) leaves the name alone
          * a string renames the tab
          * None CLEARS it back to the automatic coin + count label
        The terminal reads the KEY, not the value, so never pass a title you read back from
        get_tab — that freezes a rendered label like "BTC (3)" as a permanent custom name. active
        takes only True; there is no "unfocus this tab". raise_window (default True) surfaces the
        window when the tab being activated is in a background one.
        """
        # Built key by key rather than through the usual `if v is not None` filter: that filter is
        # what makes None mean ABSENT everywhere else, and here None is the whole point.
        body: dict[str, Any] = {}
        if title is not UNSET:
            body["title"] = title
        if index is not None:
            body["index"] = index
        if active is not None:
            body["active"] = active
        if raise_window is not None:
            body["raiseWindow"] = raise_window
        return self._req("PATCH", f"/app/tabs/{self._seg(tab_id)}", body)

    def close_tab(self, tab_id: str) -> dict:
        """DELETE /app/tabs/{tabId} — its slots, feeds and floating chart windows close with it.

        Closing the last tab of a BOOK window closes the window; closing the last tab of the MAIN
        window is refused (409 last_tab). Answers {"status": "removed", "tabId": ...}.
        """
        return self._req("DELETE", f"/app/tabs/{self._seg(tab_id)}")

    def add_slots(
        self,
        slots: list[dict],
        tab_id: str | None = None,
        target: dict | None = None,
        stack: str | None = None,
        activate: bool = False,
    ) -> dict:
        """POST /app/slots -> 201 — ADD one or more boxes. It never replaces one.

        slots: [{"content": {...}, "share"?: 0.0-1.0}, ...] — at most 16, each item its own box.
        share lives HERE, not inside the content; it is converted PER INSERTION, so the i-th box
        asks for a fraction of what is LEFT, and values clamp into 0.05-0.95.
        target: {"slot": <anchor id>, "side": "left"|"right"|"top"|"bottom"} OR {"edge": <side>} —
        never both, and "side" may not travel without "slot". Omitted = {"edge": "right"}. The
        ANCHOR box survives with its id, its content and its live feed; it only gets smaller.
        stack ("row"|"column", default "column") is how the NEW boxes arrange among THEMSELVES.
        Answers {"status": "added", "slots": [<every box, in request order>]}.
        """
        pinned = [{**s, "content": self._kind_first(s["content"])} for s in slots]
        body: dict[str, Any] = {"tabId": tab_id, "target": target, "stack": stack, "slots": pinned}
        if activate:
            body["activate"] = True
        return self._req("POST", "/app/slots", {k: v for k, v in body.items() if v is not None})

    def get_slot(self, slot_id: str) -> dict:
        """GET /app/slots/{slotId} — one box and where it sits.

        Answers {"slot": {...}, "position": {"windowId", "tabId", "path", "depth", "parent"?}} —
        note the durable string ids, where the deprecated panel lookup spelled them "window" (an
        int index) and "tab". parent is absent exactly when the slot is a root (a single-box tab).
        """
        return self._req("GET", f"/app/slots/{self._seg(slot_id)}")

    def set_slot(self, slot_id: str, content: dict) -> dict:
        """PUT /app/slots/{slotId} — declare what THIS box holds. Idempotent.

        content is REQUIRED here, unlike the deprecated set_panel where omitting it cleared the box:
            {"kind": "orderbook", "exchange": ..., "symbol": ..., "connectionId"?: ...}
            {"kind": "chart", "exchange": ..., "symbol": ..., "interval"?: ...}
            {"kind": "empty"}   # clears it — the box stays with its id (or call clear_slot)
        A kind transition is legal and the slot id never changes; a same-state request is a no-op
        that still answers 200. On a WIDGET box every set is refused (409), a clear included.
        Answers {"status": "changed", "slot": {...}}.
        """
        return self._req("PUT", f"/app/slots/{self._seg(slot_id)}", {"content": self._kind_first(content)})

    def clear_slot(self, slot_id: str) -> dict:
        """Clear the box — it stays on screen and keeps its id and its position."""
        return self.set_slot(slot_id, {"kind": "empty"})

    def remove_slot(self, slot_id: str) -> dict:
        """DELETE /app/slots/{slotId} — structural: the box is gone and its id retired.

        A chart paired under an orderbook goes with it. Answers {"status": "removed", "slotId": ...}.
        """
        return self._req("DELETE", f"/app/slots/{self._seg(slot_id)}")

    def list_chart_windows(self, tab_id: str | None = None, kind: str | None = None) -> list[dict]:
        """GET /app/chart-windows — the floating chart windows, each carrying the tabId that owns it.

        kind filters to "chart" or "comboChart".
        """
        return self._req("GET", "/app/chart-windows" + self._qs(tabId=tab_id, kind=kind))["chartWindows"]

    def open_chart_window(
        self,
        kind: str,
        exchange: str,
        symbol: str,
        interval: str | None = None,
        intervals: list[str] | None = None,
        tab_id: str | None = None,
        activate: bool = False,
    ) -> dict:
        """POST /app/chart-windows -> 200 OR 201 — open a coin's chart window, or its combo chart.

        201 opened a window. 200 means that (kind, exchange, symbol) was ALREADY open and the live
        window was re-homed and shown — not an error, and not a new window. interval is "chart"
        only (refused on comboChart; omitted = M5); intervals is exactly three and "comboChart"
        only (omitted = M5/M15/H1). tab_id omitted = the active tab of the main window.
        Answers {"status": "opened"|"changed", "chartWindow": {...}}.
        """
        body: dict[str, Any] = {
            "kind": kind,
            "exchange": exchange,
            "symbol": symbol,
            "interval": interval,
            "intervals": intervals,
            "tabId": tab_id,
        }
        if activate:
            body["activate"] = True
        return self._req("POST", "/app/chart-windows", {k: v for k, v in body.items() if v is not None})

    def update_chart_window(
        self,
        chart_window_id: str,
        exchange: str | None = None,
        symbol: str | None = None,
        interval: str | None = None,
        intervals: list[str] | None = None,
        tab_id: str | None = None,
        pinned: bool | None = None,
        locked: bool | None = None,
        sync: bool | None = None,
        active: bool | None = None,
    ) -> dict:
        """PATCH /app/chart-windows/{id} — retarget, re-interval, re-home, pin, lock or raise it.

        Name at least one. interval is "chart" only, intervals/sync "comboChart" only, active takes
        only True (it raises the window). sync is EXCLUSIVE across combo windows and the answer
        reports only THIS window, so re-read list_chart_windows to see what it turned off.
        """
        body: dict[str, Any] = {
            "exchange": exchange,
            "symbol": symbol,
            "interval": interval,
            "intervals": intervals,
            "tabId": tab_id,
            "pinned": pinned,
            "locked": locked,
            "sync": sync,
            "active": active,
        }
        return self._req(
            "PATCH",
            f"/app/chart-windows/{self._seg(chart_window_id)}",
            {k: v for k, v in body.items() if v is not None},
        )

    def close_chart_window(self, chart_window_id: str) -> dict:
        """DELETE /app/chart-windows/{id} — close it. Answers {"status": "removed", "chartWindowId": ...}."""
        return self._req("DELETE", f"/app/chart-windows/{self._seg(chart_window_id)}")

    # ── notifications & signals ──────────────────────────────────────────────
    def notify(self, message: str, severity: str = "info", source: str | None = None) -> dict:
        """POST /notifications — raise a toast. severity: info|success|warning|error."""
        return self._req("POST", "/notifications", {"message": message, "severity": severity, "source": source})

    def signal(self, exchange: str, symbol: str, text: str) -> dict:
        return self._req("POST", "/signals", {"exchange": exchange, "symbol": symbol, "text": text})

    # ── signal levels ────────────────────────────────────────────────────────
    def signal_levels(self, exchange: str | None = None, symbol: str | None = None) -> list[dict]:
        """GET /signal-levels — filter by venue / symbol."""
        return self._req("GET", "/signal-levels" + self._qs(exchange=exchange, symbol=symbol))["levels"]

    def create_signal_level(
        self,
        exchange: str,
        symbol: str,
        price: str,
        direction: str = "cross",
        note: str | None = None,
        one_shot: bool = False,
    ) -> dict:
        """POST /signal-levels -> 201. A level fires at most once: one_shot removes it on fire, else it
        is kept marked isTriggered (sweep with delete_triggered_signal_levels). A level is a pure
        market alert — venue + symbol only, never tied to a connection."""
        body = {
            "exchange": exchange,
            "symbol": symbol,
            "price": price,
            "direction": direction,
            "note": note,
            "oneShot": one_shot,
        }
        return self._req("POST", "/signal-levels", {k: v for k, v in body.items() if v is not None})

    def delete_signal_level(self, level_id: str) -> dict:
        """DELETE /signal-levels/{id} -> {removed: 1}."""
        return self._req("DELETE", f"/signal-levels/{level_id}")

    def delete_signal_levels(self, exchange: str, symbol: str) -> dict:
        """DELETE /signal-levels?exchange=&symbol= — clear every level of one symbol -> {removed}."""
        return self._req("DELETE", "/signal-levels" + self._qs(exchange=exchange, symbol=symbol))

    def delete_triggered_signal_levels(self) -> dict:
        """DELETE /signal-levels/triggered — sweep every fired level -> {removed}."""
        return self._req("DELETE", "/signal-levels/triggered")

    # ── streaming ────────────────────────────────────────────────────────────
    def stream(self) -> "ColibriSocket":
        from .socket import ColibriSocket

        return ColibriSocket(self.base, self._token)
