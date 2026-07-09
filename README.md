# Colibri Local API — Widget SDK

Interactive explorer + reference for the **Colibri Local API**: the loopback
HTTP/WebSocket API that lets external widgets (screeners, bots, HUDs) integrate
with the Colibri scalping terminal — over `127.0.0.1`, guarded by a bearer token.

**Live explorer → https://colibriecosystem.github.io/colibri-sdk/**

## Using it

1. In Colibri: **Settings → Program → Local API** → turn it on, tick
   **“Allow web browser access”**, copy the **port** + **access token**.
2. Open the explorer, paste the port + token, hit **Connect**.
3. Expand any endpoint and hit **Send**, or subscribe to a live WebSocket channel
   (`book` / `trades` / `funding` / `positions` / `orders` / `balance` /
   `notifications` / `signalLevels`).

The explorer talks to **your own** running terminal — nothing leaves your machine.
The token guards every request; reads work by token, trading needs an explicit
per-connection grant.
