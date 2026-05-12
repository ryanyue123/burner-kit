import { DurableObject } from "cloudflare:workers";
import { Schema } from "effect";
import { MercureSubscriber } from "../services/mail-tm-mercure";
import { Effect, ManagedRuntime } from "effect";
import type { Layer } from "effect";
import * as schema from "../db/schema";
import { makeServicesLayer } from "../runtime";
import { EmailAccountService } from "../services/email-account";
import { EmailMessageService } from "../services/email-message";

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
  private runtime: ManagedRuntime.ManagedRuntime<
    Layer.Layer.Success<ReturnType<typeof makeServicesLayer>>,
    never
  > | null = null;

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

    // Browsers require the server to echo back exactly one of the offered
    // Sec-WebSocket-Protocol values for the upgrade to succeed. The parent
    // Worker validated auth via the `bearer.<token>` subprotocol; here we
    // echo back only `channel.v1` so the secret never appears in the
    // response.
    const offered = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
      .split(",")
      .map((s) => s.trim());
    const responseHeaders = new Headers();
    if (offered.includes("channel.v1")) {
      responseHeaders.set("Sec-WebSocket-Protocol", "channel.v1");
    }
    return new Response(null, { status: 101, webSocket: client, headers: responseHeaders });
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
    console.log(
      `[latency] pushed messageId=${payload.messageId} code=${payload.code ?? "null"} ts=${Date.now()}`,
    );
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

  private async activate(userId: string): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.runtime ??= ManagedRuntime.make(makeServicesLayer(this.env));

    const accounts = await this.runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmailAccountService;
        return yield* svc.listActiveByUserId(userId);
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.logError(`[user-channel] listActive failed: ${cause}`).pipe(
            Effect.as<ReadonlyArray<typeof schema.emailAccount.$inferSelect>>([]),
          ),
        ),
      ),
    );

    for (const account of accounts) {
      if (this.subscribers.has(account.id)) continue;
      const sub = new MercureSubscriber({
        accountId: account.providerAccountId,
        token: account.providerToken,
        onEvent: (event) => this.handleMercureEvent(account, event),
        onError: (err) => {
          console.error(`[user-channel] mercure error for ${account.email}:`, err);
        },
      });
      sub.open();
      this.subscribers.set(account.id, sub);
    }
  }

  private async deactivate(): Promise<void> {
    this.active = false;
    for (const sub of this.subscribers.values()) sub.close();
    this.subscribers.clear();
    if (this.runtime) {
      await this.runtime.dispose();
      this.runtime = null;
    }
    // We do NOT close the WebSocket here — clients stay attached and
    // hibernate. The next heartbeat will re-activate via the inbound handler.
  }

  private async handleMercureEvent(
    account: typeof schema.emailAccount.$inferSelect,
    event: import("../services/mail-tm-mercure").MercureEvent,
  ): Promise<void> {
    if (event.kind !== "arrive") return;
    console.log(
      `[latency] mercure_arrive messageId=${event.messageId} accountId=${account.id} ts=${Date.now()}`,
    );
    this.broadcast({
      type: "message",
      accountId: account.id,
      messageId: event.messageId,
    });
    const runtime = this.runtime;
    if (!runtime) return;
    await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* EmailMessageService;
        yield* svc.syncAccountInternal(account);
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.logError(`[user-channel] sync failed for ${account.email}: ${cause}`),
        ),
      ),
    );
    console.log(`[latency] synced messageId=${event.messageId} ts=${Date.now()}`);
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
