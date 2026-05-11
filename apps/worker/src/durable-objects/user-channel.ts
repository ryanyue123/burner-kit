import { DurableObject } from "cloudflare:workers";
import { Schema } from "effect";
import { MercureSubscriber } from "../services/mail-tm-mercure";

// ---------- Wire protocol ----------
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
  /** In-memory only — wiped on hibernation. Rebuilt on activate. */
  private subscribers = new Map<string, MercureSubscriber>();
  private active = false;

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
    await this.activate(userId);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const result = decodeInbound(parsed);
    if (result._tag === "Left") return;
    const msg = result.right;
    if (msg.type === "heartbeat" || msg.type === "subscribe") {
      await this.extendAlarm();
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (att?.userId) await this.activate(att.userId);
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
    // socket will close
  }

  async ensureSubscribed(): Promise<void> {
    const userId = this.userIdFromAnySocket();
    if (!userId) {
      // No socket yet — set an alarm so we'll re-check soon. The next WS
      // connect (or heartbeat) will pick up the burner.
      await this.extendAlarm();
      return;
    }
    await this.extendAlarm();
    await this.activate(userId);
  }

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
    await this.deactivate();
  }

  // ------------------------------------------------------------------
  // State transitions
  // ------------------------------------------------------------------

  private async activate(_userId: string): Promise<void> {
    if (this.active) return;
    this.active = true;
    // Mercure subscription setup arrives in Task 5. For now this is a no-op
    // beyond flipping the flag.
  }

  private async deactivate(): Promise<void> {
    this.active = false;
    for (const sub of this.subscribers.values()) sub.close();
    this.subscribers.clear();
    // We do NOT close the WebSocket here — clients stay attached and
    // hibernate. The next heartbeat will re-activate via the inbound handler.
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async extendAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + ACTIVE_TTL_MS);
  }

  private userIdFromAnySocket(): string | null {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (att?.userId) return att.userId;
    }
    return null;
  }

  private broadcast(msg: ChannelOutbound): void {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, msg);
  }

  private send(ws: WebSocket, msg: ChannelOutbound): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closed mid-broadcast
    }
  }
}
