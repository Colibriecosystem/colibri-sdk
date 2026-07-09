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
            err = (json.loads(text).get("error") if text else None) or {}
            raise ColibriError(exc.code, err.get("code", f"http_{exc.code}"), err.get("message", text)) from None
        return json.loads(text) if text else None

    @staticmethod
    def _qs(**params: Any) -> str:
        clean = {k: v for k, v in params.items() if v is not None}
        return ("?" + urllib.parse.urlencode(clean)) if clean else ""

    # ── discovery ────────────────────────────────────────────────────────────
    def ping(self) -> dict:
        return self._req("GET", "/ping")

    # ── connections ──────────────────────────────────────────────────────────
    def connections(self) -> list[dict]:
        return self._req("GET", "/connections")["connections"]

    def connection(self, connection_id: str) -> dict:
        return self._req("GET", f"/connections/{urllib.parse.quote(connection_id)}")

    # ── market data ──────────────────────────────────────────────────────────
    def symbols(self, exchange: str) -> list[dict]:
        return self._req("GET", "/symbols" + self._qs(exchange=exchange))["symbols"]

    def book(self, exchange: str, symbol: str, depth: int | None = None, aggregation: int | None = None) -> dict:
        return self._req("GET", f"/book/{exchange}/{symbol}" + self._qs(depth=depth, aggregation=aggregation))

    def clusters(self, exchange: str, symbol: str, timeframe: str | None = None) -> dict:
        return self._req("GET", f"/clusters/{exchange}/{symbol}" + self._qs(timeframe=timeframe))

    def funding(self, exchange: str, symbol: str) -> dict:
        return self._req("GET", f"/funding/{exchange}/{symbol}")

    # ── account ──────────────────────────────────────────────────────────────
    def positions(self, connection_id: str) -> list[dict]:
        return self._req("GET", "/positions" + self._qs(connectionId=connection_id))["positions"]

    def orders(self, connection_id: str) -> list[dict]:
        return self._req("GET", "/orders" + self._qs(connectionId=connection_id))["orders"]

    def balance(self, connection_id: str) -> list[dict]:
        return self._req("GET", "/balance" + self._qs(connectionId=connection_id))["balances"]

    # ── trading (per-connection grant required) ──────────────────────────────
    def place_order(
        self,
        connection_id: str,
        exchange: str,
        symbol: str,
        side: str,
        type: str,  # noqa: A002 - matches the wire field
        price: str | None = None,
        size_quote: str | None = None,
        size_base: str | None = None,
        reduce_only: bool = False,
    ) -> dict:
        body = {
            "connectionId": connection_id,
            "exchange": exchange,
            "symbol": symbol,
            "side": side,
            "type": type,
            "price": price,
            "sizeQuote": size_quote,
            "sizeBase": size_base,
            "reduceOnly": reduce_only,
        }
        return self._req("POST", "/orders", {k: v for k, v in body.items() if v is not None})

    def cancel_order(self, client_order_id: str, connection_id: str) -> dict:
        return self._req("DELETE", f"/orders/{client_order_id}" + self._qs(connectionId=connection_id))

    def cancel_all(self, connection_id: str, exchange: str, symbol: str) -> dict:
        return self._req("POST", "/orders/cancelAll", {"connectionId": connection_id, "exchange": exchange, "symbol": symbol})

    def panic_cancel_all_orders(self, connection_id: str | None = None) -> dict:
        return self._req("POST", "/panic/cancel-all-orders", {"connectionId": connection_id})

    def panic_close_all_positions(self, connection_id: str | None = None) -> dict:
        return self._req("POST", "/panic/close-all-positions", {"connectionId": connection_id})

    # ── app bridge ───────────────────────────────────────────────────────────
    def open_symbol(self, exchange: str, symbol: str) -> dict:
        return self._req("POST", "/app/open-symbol", {"exchange": exchange, "symbol": symbol})

    def open_combo(self, symbol: str, target: str = "window") -> dict:
        return self._req("POST", "/app/open-combo", {"symbol": symbol, "target": target})

    # ── notifications & signals ──────────────────────────────────────────────
    def notify(self, message: str, severity: str = "info", source: str | None = None) -> dict:
        return self._req("POST", "/notifications", {"message": message, "severity": severity, "source": source})

    def signal(self, exchange: str, symbol: str, text: str) -> dict:
        return self._req("POST", "/signals", {"exchange": exchange, "symbol": symbol, "text": text})

    # ── signal levels ────────────────────────────────────────────────────────
    def signal_levels(self, exchange: str | None = None, symbol: str | None = None) -> list[dict]:
        return self._req("GET", "/signal-levels" + self._qs(exchange=exchange, symbol=symbol))["levels"]

    def create_signal_level(
        self, exchange: str, symbol: str, price: str, direction: str = "cross", note: str | None = None, one_shot: bool = False
    ) -> dict:
        return self._req(
            "POST",
            "/signal-levels",
            {"exchange": exchange, "symbol": symbol, "price": price, "direction": direction, "note": note, "oneShot": one_shot},
        )

    def delete_signal_level(self, level_id: str) -> None:
        self._req("DELETE", f"/signal-levels/{level_id}")

    # ── streaming ────────────────────────────────────────────────────────────
    def stream(self) -> "ColibriSocket":
        from .socket import ColibriSocket

        return ColibriSocket(self.base, self._token)
