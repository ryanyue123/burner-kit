import { DurableObject } from "cloudflare:workers";
import { Schema } from "effect";

// ---------- Wire protocol ----------
// Schemas are the source of truth; types are derived. Both ends of the
// extension↔DO connection re-declare these in sync (see
// `apps/extension/lib/user-channel-client.ts`).

export const ChannelOutbound = Schema.Union(
  Schema.Struct({ type: Schema.Literal("hello"), userId: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("ready"),
    accountId: Schema.String,
    messageId: Schema.String,
    code: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("message"),
    accountId: Schema.String,
    messageId: Schema.String,
  }),
);
export type ChannelOutbound = typeof ChannelOutbound.Type;

export const ChannelInbound = Schema.Union(
  Schema.Struct({ type: Schema.Literal("heartbeat") }),
  Schema.Struct({ type: Schema.Literal("subscribe") }),
);
export type ChannelInbound = typeof ChannelInbound.Type;

const decodeInbound = Schema.decodeUnknownEither(ChannelInbound);

interface SocketAttachment {
  userId: string;
}

const ACTIVE_TTL_MS = 90_000;

export class UserChannel extends DurableObject<Env> {
  /**
   * HTTP entry. Expects a WebSocket Upgrade with a `userId` injected by the
   * parent Worker (which validates the session). The DO trusts this header
   * because routing is keyed by `idFromName(userId)` and only the Worker
   * can construct that stub.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("missing user id", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies SocketAttachment);

    this.send(server, { type: "hello", userId });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // malformed JSON, drop silently
    }
    const result = decodeInbound(parsed);
    if (result._tag === "Left") return; // schema mismatch, drop silently
    const msg = result.right;
    if (msg.type === "heartbeat" || msg.type === "subscribe") {
      await this.extendAlarm();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  async webSocketError(_ws: WebSocket, _err: unknown): Promise<void> {
    // logged by runtime; nothing to do — the socket will close
  }

  /** Called by other Workers via RPC to ensure mercure subscriptions are open. */
  async ensureSubscribed(): Promise<void> {
    await this.extendAlarm();
  }

  /** Called by other Workers via RPC when extraction completes. */
  async pushCode(payload: {
    accountId: string;
    messageId: string;
    code: string | null;
  }): Promise<void> {
    this.broadcast({
      type: "ready",
      accountId: payload.accountId,
      messageId: payload.messageId,
      code: payload.code,
    });
  }

  async alarm(): Promise<void> {
    // Stub: filled in by Task 4 — tears down Mercure subscriptions.
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async extendAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + ACTIVE_TTL_MS);
  }

  private broadcast(msg: ChannelOutbound): void {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) this.send(ws, msg);
  }

  private send(ws: WebSocket, msg: ChannelOutbound): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closed mid-broadcast; the runtime will fire webSocketClose
    }
  }
}
