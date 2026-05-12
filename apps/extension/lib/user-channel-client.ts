import { WebSocket as ReconnectingWebSocket } from "partysocket";

// Keep in sync with `apps/worker/src/durable-objects/user-channel.ts`. The
// worker uses Effect Schema for these; the extension doesn't pull Effect in,
// so we mirror the shapes as plain discriminated unions.
export type ChannelOutbound =
  | { type: "hello"; userId: string }
  | { type: "ready"; accountId: string; messageId: string; code: string | null }
  | { type: "message"; accountId: string; messageId: string };

export type ChannelInbound = { type: "heartbeat" } | { type: "subscribe" };

export interface UserChannelClientOptions {
  /** ws:// or wss:// URL pointing at /api/channel/connect. */
  url: string;
  /**
   * Better Auth session token. Sent as a WS subprotocol entry
   * (`bearer.<token>`) on the upgrade handshake. The browser refuses to
   * forward the session cookie on cross-origin WS upgrades from a service
   * worker, so we authenticate via subprotocol bearer instead.
   */
  token: string;
  onMessage: (msg: ChannelOutbound) => void;
  onStateChange?: (state: "connecting" | "open" | "closed") => void;
}

const HEARTBEAT_MS = 25_000; // well under Cloudflare's 100 s idle disconnect

export class UserChannelClient {
  private ws: ReconnectingWebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: UserChannelClientOptions) {}

  connect(): void {
    if (this.ws) return;
    this.opts.onStateChange?.("connecting");

    // Two-subprotocol bearer auth: server validates the `bearer.<token>`
    // entry, then echoes back only `channel.v1` in the 101 response. The
    // token never appears in the response or URL.
    this.ws = new ReconnectingWebSocket(
      this.opts.url,
      ["channel.v1", `bearer.${this.opts.token}`],
      {
        maxRetries: Infinity,
        minReconnectionDelay: 1_000,
        maxReconnectionDelay: 30_000,
        reconnectionDelayGrowFactor: 1.5,
        // We use an application-level heartbeat (regular message, not a WS
        // ping frame) so the DO actually wakes from hibernation. partysocket's
        // built-in pingTimeout uses ping frames — wrong shape for our case.
      },
    );

    this.ws.addEventListener("open", () => {
      this.opts.onStateChange?.("open");
      this.subscribe();
      this.heartbeatTimer = setInterval(() => this.send({ type: "heartbeat" }), HEARTBEAT_MS);
    });

    this.ws.addEventListener("close", () => {
      this.opts.onStateChange?.("closed");
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    });

    this.ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      let parsed: ChannelOutbound;
      try {
        parsed = JSON.parse(raw) as ChannelOutbound;
      } catch {
        return;
      }
      this.opts.onMessage(parsed);
    });
  }

  send(msg: ChannelInbound): void {
    // partysocket buffers when not OPEN and flushes on reconnect.
    this.ws?.send(JSON.stringify(msg));
  }

  /** Send a `subscribe` hint. Used on `CODE_DETECTED` and after
   *  successful `GENERATE_EMAIL`. */
  subscribe(): void {
    this.send({ type: "subscribe" });
  }

  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
