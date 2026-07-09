"""WebSocket client for the Colibri ``/stream`` endpoint.

Requires the ``websocket-client`` package (``pip install websocket-client``).
"""
from __future__ import annotations

import json
import threading
import urllib.parse
from typing import Any, Callable


class ColibriSocket:
    """
    Subscribe to live channels: ``book`` / ``trades`` / ``funding`` / ``positions`` /
    ``orders`` / ``balance`` / ``notifications`` / ``signalLevels``.

    ::

        ws = client.stream()
        ws.on("trades", lambda data, frame: print(data))
        ws.connect()
        ws.subscribe("trades", exchange="BinanceSpot", symbol="BTCUSDT")
        ws.run_forever()   # or keep your own loop alive
    """

    def __init__(self, base: str, token: str) -> None:
        ws_base = "ws" + base[len("http"):]
        self.url = ws_base + "/stream?access_token=" + urllib.parse.quote(token)
        self._handlers: dict[str, list[Callable[[Any, dict], None]]] = {}
        self._outbox: list[str] = []
        self._open = threading.Event()
        self._ws = None

    def on(self, event: str, handler: Callable[[Any, dict], None]) -> "ColibriSocket":
        """Register a handler for a channel name, ``"error"``, or ``"*"`` (every frame)."""
        self._handlers.setdefault(event, []).append(handler)
        return self

    def connect(self) -> "ColibriSocket":
        import websocket  # websocket-client

        self._ws = websocket.WebSocketApp(
            self.url,
            on_open=self._on_open,
            on_message=self._on_message,
        )
        threading.Thread(target=self._ws.run_forever, daemon=True).start()
        self._open.wait(timeout=10)
        return self

    def subscribe(self, channel: str, **params: Any) -> "ColibriSocket":
        self._send({"type": "subscribe", "data": {"channel": channel, **params}})
        return self

    def unsubscribe(self, channel: str, **params: Any) -> "ColibriSocket":
        self._send({"type": "unsubscribe", "data": {"channel": channel, **params}})
        return self

    def run_forever(self) -> None:
        """Block the calling thread until interrupted (handlers fire on the socket thread)."""
        try:
            while True:
                self._open.wait(timeout=3600)
        except KeyboardInterrupt:
            self.close()

    def close(self) -> None:
        if self._ws is not None:
            self._ws.close()

    # ── internals ────────────────────────────────────────────────────────────
    def _send(self, obj: dict) -> None:
        msg = json.dumps(obj)
        if self._open.is_set() and self._ws is not None:
            self._ws.send(msg)
        else:
            self._outbox.append(msg)

    def _on_open(self, ws) -> None:
        self._open.set()
        for msg in self._outbox:
            ws.send(msg)
        self._outbox.clear()

    def _on_message(self, _ws, raw: str) -> None:
        try:
            frame = json.loads(raw)
        except json.JSONDecodeError:
            return
        data = frame.get("data", frame)
        for event in (frame.get("type"), "*"):
            for handler in self._handlers.get(event, []):
                handler(data, frame)
