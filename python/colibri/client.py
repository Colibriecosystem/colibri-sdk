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
# serves v2 (check ``supportedApiVersions`` on ``/ping``). From terminal 1.3.0 v1 is removed and the
# header is ignored.
API_VERSION = 2


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
