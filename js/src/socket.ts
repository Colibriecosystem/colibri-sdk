import type { Channel, SubscribeParams } from "./types.js";

export interface SocketOptions {
  base: string;
  /** Unused — `/stream` takes no credential. Kept so `new ColibriSocket({base, token})` still compiles. */
  token?: string;
}

type Handler = (data: unknown, frame: StreamFrame) => void;

export interface StreamFrame {
  type: string;
  event?: string;
  data?: unknown;
}

/**
 * WebSocket client for `/stream`. Browser + Node 22+ both ship a global `WebSocket`; on older Node
 * install `ws` and `globalThis.WebSocket = require("ws")` before use.
 *
 * ```ts
 * const ws = client.stream();
 * ws.on("trades", t => console.log(t));
 * await ws.connect();
 * ws.subscribe("trades", { exchange: "BinanceSpot", symbol: "BTCUSDT" });
 * ```
 */
export class ColibriSocket {
  private ws?: WebSocket;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly outbox: string[] = [];

  constructor(private readonly opts: SocketOptions) {}

  /** Resolves once the socket is open (queued subscribes are flushed automatically). */
  connect(): Promise<void> {
    // No credential: nothing on this socket moves money, so every channel it carries is open.
    // (Origin + Host are still checked server-side.) The old ?access_token= query is gone —
    // the server ignores it, and a token in a URL leaks into logs and history.
    const url = this.opts.base.replace(/^http/, "ws") + "/stream";
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onmessage = (ev: MessageEvent) => {
      const raw = typeof ev.data === "string" ? ev.data : "";
      let frame: StreamFrame;
      try {
        frame = JSON.parse(raw);
      } catch {
        return;
      }
      this.emit(frame.type, frame.data ?? frame, frame);
      this.emit("*", frame.data ?? frame, frame);
    };

    return new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        for (const msg of this.outbox) ws.send(msg);
        this.outbox.length = 0;
        resolve();
      };
      ws.onerror = (e) => reject(e);
    });
  }

  /** Subscribe to a channel. Market channels take exchange+symbol; account channels take connectionId. */
  subscribe(channel: Channel, params: SubscribeParams = {}): this {
    this.send({ type: "subscribe", data: { channel, ...params } });
    return this;
  }

  unsubscribe(channel: Channel, params: SubscribeParams = {}): this {
    this.send({ type: "unsubscribe", data: { channel, ...params } });
    return this;
  }

  /**
   * Register a handler for a frame TYPE: a market/account channel name (`"book"`, `"trades"`, …),
   * `"notification"` / `"signalLevel"` (the app-wide channels push singular frame types),
   * `"subscribed"` / `"unsubscribed"` (acks), `"error"`, or `"*"` for every frame.
   */
  on(
    event: Channel | "notification" | "signalLevel" | "subscribed" | "unsubscribed" | "error" | "*",
    handler: Handler,
  ): this {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return this;
  }

  close(): void {
    this.ws?.close();
  }

  private send(obj: unknown): void {
    const msg = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === 1) this.ws.send(msg);
    else this.outbox.push(msg);
  }

  private emit(event: string, data: unknown, frame: StreamFrame): void {
    this.handlers.get(event)?.forEach((h) => h(data, frame));
  }
}
