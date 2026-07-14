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


class ColibriClient:
    """
    Talk to a running Colibri terminal over the loopback Local API.

    Reads work with just the token; trading needs a per-connection grant
    (Settings -> Program -> Local API). Every price/size on the wire is a decimal STRING.
    """

    def __init__(self, port: int | str, token: str, host: str = "127.0.0.1") -> None:
        self.base = f"http://{host}:{port}"
        self._token = token

    @classmethod
    def discover(cls, host: str = "127.0.0.1") -> "ColibriClient":
        """Auto-connect via the discovery file the terminal writes while the API is on."""
        app_data = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
        path = os.path.join(app_data, "Colibri", "localapi.json")
        with open(path, encoding="utf-8") as fh:
            j = json.load(fh)
        return cls(j["port"], j["token"], host)

    # ── transport ────────────────────────────────────────────────────────────
    def _req(self, method: str, path: str, body: Any | None = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self._token}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
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

    # ── discovery ────────────────────────────────────────────────────────────
    def ping(self) -> dict:
        """Liveness + version + the live bound port — the one token-free route."""
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
        return self._req("GET", f"/markets/{exchange}/{symbol}/book" + self._qs(depth=depth))

    def clusters(self, exchange: str, symbol: str, limit: int | None = None) -> dict:
        """GET /markets/{exchange}/{symbol}/clusters — raw 1-minute buckets (merge timeframes yourself); limit 1-4320."""
        return self._req("GET", f"/markets/{exchange}/{symbol}/clusters" + self._qs(limit=limit))

    def funding(self, exchange: str, symbol: str) -> dict:
        """GET /markets/{exchange}/{symbol}/funding — perps only (spot answers 404 'unavailable')."""
        return self._req("GET", f"/markets/{exchange}/{symbol}/funding")

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
        """DELETE /orders — emergency sweep: cancel every order on EVERY granted account."""
        return self._req("DELETE", "/orders")

    def close_all_positions(self) -> dict:
        """DELETE /positions — emergency sweep: close every position on EVERY granted account."""
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

    # ── panel control (/app/panels) ──────────────────────────────────────────
    # A SLOT is the durable box — its GUID slotId survives an instrument change, a clear, and a
    # terminal restart. content is ONE instrument + the views that render it:
    #   {"exchange": ..., "symbol": ..., "views": ["orderbook"] | ["chart"] | ["orderbook","chart"],
    #    "connectionId"?: ...}
    # connectionId binds a trading account (grant-gated; requires the orderbook view); omitted =
    # the app adopts the venue's default connection by itself.

    def panels(self, tab_id: str | None = None, window_index: int | None = None) -> list[dict]:
        """The window → tab → slot tree, optionally scoped to one tab (durable id) / window (index)."""
        return self._req("GET", "/app/panels" + self._qs(tabId=tab_id, windowIndex=window_index))["windows"]

    def add_panel(self, content: dict | None = None, tab_id: str | None = None, activate: bool = False) -> dict:
        """Add a panel to a tab (the ACTIVE tab when tab_id is omitted — right-click a tab header to copy its id).

        content=None adds an EMPTY "+" box instead — reserve now, fill later by its durable id via
        set_panel (each empty add reserves a fresh box). activate=True surfaces the terminal window
        afterwards (default False so a background layout tool never steals focus).
        """
        body: dict[str, Any] = {"tabId": tab_id, "content": content}
        if activate:
            body["activate"] = True
        return self._req("POST", "/app/panels", {k: v for k, v in body.items() if v is not None})

    def set_panel(self, slot_id: str, content: dict | None = None) -> dict:
        """Idempotently set a slot's desired state — instrument, views (kind transitions ok), account.

        content=None CLEARS the slot (the box stays and keeps its id).
        """
        return self._req("PUT", f"/app/panels/{slot_id}", {"content": content} if content is not None else {})

    def remove_panel(self, slot_id: str) -> dict:
        """Remove the slot entirely (its paired chart goes with it)."""
        return self._req("DELETE", f"/app/panels/{slot_id}")

    # ── notifications & signals ──────────────────────────────────────────────
    def notify(self, message: str, severity: str = "info", source: str | None = None) -> dict:
        """POST /notifications — raise a toast. severity: info|success|warning|error."""
        return self._req("POST", "/notifications", {"message": message, "severity": severity, "source": source})

    def signal(self, exchange: str, symbol: str, text: str) -> dict:
        return self._req("POST", "/signals", {"exchange": exchange, "symbol": symbol, "text": text})

    # ── signal levels ────────────────────────────────────────────────────────
    def signal_levels(
        self, exchange: str | None = None, symbol: str | None = None, connection_id: str | None = None
    ) -> list[dict]:
        """GET /signal-levels — filter by venue / symbol / owning connection."""
        return self._req("GET", "/signal-levels" + self._qs(exchange=exchange, symbol=symbol, connectionId=connection_id))["levels"]

    def create_signal_level(
        self,
        exchange: str,
        symbol: str,
        price: str,
        direction: str = "cross",
        note: str | None = None,
        one_shot: bool = False,
        connection_id: str | None = None,
    ) -> dict:
        """POST /signal-levels -> 201. A level fires at most once: one_shot removes it on fire, else it
        is kept marked isTriggered (sweep with delete_triggered_signal_levels). connection_id
        optionally ties the level to a connection (organizational — no trading grant needed)."""
        body = {
            "exchange": exchange,
            "symbol": symbol,
            "price": price,
            "direction": direction,
            "note": note,
            "oneShot": one_shot,
            "connectionId": connection_id,
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
