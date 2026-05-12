# Mercure-Driven Code Push Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 60-second cron-driven message polling with a real-time push channel: a per-user Durable Object that (a) subscribes to mail.tm's Mercure SSE for each of the user's active burner accounts and (b) holds a hibernating WebSocket to the extension, so codes surface in ~1–3s after arrival instead of 0–90s.

**Architecture:** A `UserChannel` Durable Object keyed by `userId` operates in two states. **Active**: outgoing Mercure SSE subscriptions are open (one per burner), the extension's WebSocket is attached, and a server-side alarm is set 90 s into the future. Each heartbeat from the extension resets that alarm. When the alarm fires (no heartbeat), the DO closes its SSE streams and goes **idle** — the WS hibernates, in-memory state is wiped, and the DO is evicted. The 1-minute cron stays in place as a long-tail safety net for idle periods. On every Mercure `arrive` event, the DO reuses the existing `EmailMessageService.syncAccountInternal` to fetch the message body, write D1, and enqueue extraction. When extraction completes, the extraction service notifies the DO over RPC; the DO pushes `{type:"ready", accountId, code}` to the extension WS, which invalidates the React Query cache so the popup and autofill icon see the code immediately.

**Tech Stack:** Cloudflare Workers (compatibility_date `2026-04-01`, `nodejs_compat`), Cloudflare Durable Objects with WebSocket Hibernation API, [`eventsource-parser`](https://www.npmjs.com/package/eventsource-parser) for Mercure SSE parsing (TransformStream variant), D1 + Drizzle ORM, Effect-TS service layer (`ManagedRuntime`) with Effect `Schema` for WS message validation, WXT extension with TanStack Query, [`partysocket`](https://github.com/cloudflare/partykit/tree/main/packages/partysocket) for the extension's WS client (reconnect, heartbeat, message buffering), mail.tm Mercure hub at `https://mercure.mail.tm/.well-known/mercure`.

**Verification model:** This repo has no test framework. Each task verifies via:

- `pnpm -w typecheck` from repo root (runs worker + extension typechecks)
- `pnpm -w lint` (oxlint)
- `pnpm -w format:check` (oxfmt)
- `pnpm --filter worker build` and `pnpm --filter extension build` for build sanity
- Manual smoke runs with `pnpm dev` for end-to-end validation

Tasks 0–12 verify only with typecheck/lint/build. All manual smoke testing — `pnpm dev`, curl-the-WS-upgrade, end-to-end OTP arrival, idle-window fallback — is consolidated in Task 13 at the end of the plan.

**Out of scope (do not do):**

- Removing the cron trigger or the existing `syncAndList`/Refresh REST path. These remain as the idle-window fallback and as fallback for clients that don't hold a WebSocket.
- Adding `vitest` or any test framework. Verification is typecheck + manual smoke per repo convention.
- Changing the mail provider, schema, or extraction pipeline.

---

## Terminology

- **Active / idle** — the two `UserChannel` states. Active = SSE subscriptions are open and the DO is awake holding the connections. Idle = no SSE, WebSocket hibernating (or closed), DO evictable.
- **`activate(userId)` / `deactivate()`** — internal DO transitions.
- **`ensureSubscribed()`** — public RPC. Means "make sure my user's accounts are subscribed to Mercure." Idempotent.
- **`pushCode(payload)`** — public RPC. Pushes an extraction result to the connected extension.
- **`{type:"subscribe"}`** — inbound WS message from the extension meaning "please activate." Sent on connect, on heartbeat, and on code-field detection.
- **`{type:"heartbeat"}`** — inbound WS message every 25 s to keep the alarm refreshed.
- **`CODE_DETECTED`** — chrome runtime message from the content script when a code input field is found on the page.

---

## File Map

**Worker (new files):**

- `apps/worker/src/durable-objects/user-channel.ts` — the `UserChannel` Durable Object class.
- `apps/worker/src/services/mail-tm-mercure.ts` — `MercureSubscriber` class that drives a long-lived `fetch()` and pipes the response body through `eventsource-parser`'s `EventSourceParserStream`.
- `apps/worker/src/services/user-channel.ts` — `UserChannels` Effect `Context.Tag` for the DO namespace binding. Lives here (not in `extraction.ts`) because both `ExtractionService` and `EmailAccountService` consume it.

**Worker (modified):**

- `apps/worker/wrangler.toml` — add Durable Object binding + migration.
- `apps/worker/src/index.ts` — export `UserChannel`; add `/api/channel/connect` route branch before the HttpApi handler.
- `apps/worker/src/services/extraction.ts` — after writing `extractedCode` + `extractionStatus="done"`, push `{type:"ready"}` to the user's `UserChannel` over RPC.
- `apps/worker/src/services/email-account.ts` — after creating a burner, call `ensureSubscribed()` on the user's `UserChannel` so the SSE subscription opens immediately.
- `apps/worker/src/runtime.ts` — register the `UserChannels` layer and provide it to the two services that consume it.

**Extension (new files):**

- `apps/extension/lib/user-channel-client.ts` — thin wrapper around [`partysocket`](https://github.com/cloudflare/partykit/tree/main/packages/partysocket) that bakes in the URL/heartbeat config and exposes a typed `onMessage` callback. `partysocket` provides reconnect (exponential backoff), 25 s heartbeat, and message buffering while disconnected.

**Extension (modified):**

- `apps/extension/entrypoints/background.ts` — open the client after anonymous sign-in; bridge `CODE_DETECTED` chrome messages from content scripts to the WS; broadcast `ready`/`message` events back to popup and content scripts.
- `apps/extension/entrypoints/content/code-icon.ts` — when a code target is attached, send `CODE_DETECTED` to the background once per page.
- `apps/extension/entrypoints/popup/main.tsx` (or wherever `QueryClient` is constructed; Task 12 Step 1 locates it) — listen for `CHANNEL_PUSH` broadcasts and call `invalidateQueries(...)`.

---

## WebSocket Protocol (Reference)

**Client → Server (extension → DO):**

```ts
{
  type: "heartbeat";
} // every 25 s
{
  type: "subscribe";
} // on connect, on CODE_DETECTED
```

**Server → Client (DO → extension):**

```ts
{ type: "hello", userId: string }                  // sent on connect
{ type: "ready", accountId: string, messageId: string, code: string | null }
{ type: "message", accountId: string, messageId: string }  // raw arrival, pre-extraction
```

Heartbeat must be a regular WS message (not a `ping` frame) so it wakes the DO from idle and resets the alarm. A WS `ping` frame would be auto-responded to without waking the DO — wrong shape for our heartbeat.

---

## DO RPC Surface (Reference)

The DO exposes three RPC methods callable from other Workers / from itself via `env.USER_CHANNEL.get(id).method()`:

```ts
class UserChannel extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response>; // HTTP entry — WS upgrade
  async ensureSubscribed(): Promise<void>; // open mercure subs, set alarm
  async pushCode(payload: {
    accountId: string;
    messageId: string;
    code: string | null;
  }): Promise<void>;
  async alarm(): Promise<void>; // teardown SSE → deactivate
}
```

---

## Tasks

### Task 0: Rename legacy `otp-*` content files to `code-*`

The codebase has standardized on "code" terminology (`extractedCode`, `/api/codes/latest`, `GET_LATEST_CODE`, `CODE_EXTRACTION_QUEUE`). Three content-script files still use the legacy `otp-*` prefix and `Otp*` symbols. Rename them before the rest of this plan so Task 11 lands on the renamed file.

Note: there are also generic `icon.ts` and `panel.ts` files in the same directory for non-code UI. Those stay as-is. Only the code-autofill-specific files are renamed.

**Files:**

- Move: `apps/extension/entrypoints/content/otp-target.ts` → `apps/extension/entrypoints/content/code-target.ts`
- Move: `apps/extension/entrypoints/content/otp-panel.ts` → `apps/extension/entrypoints/content/code-panel.ts`
- Move: `apps/extension/entrypoints/content/otp-icon.ts` → `apps/extension/entrypoints/content/code-icon.ts`
- Modify: `apps/extension/entrypoints/content.ts` (update import)

**Symbol renames (within the moved files):**

- `OtpTarget` → `CodeTarget`
- `showOtpPanel` → `showCodePanel`
- `hidePanel` (the one exported from `otp-panel.ts`) → `hideCodePanel` (disambiguates from the unrelated `hidePanel` in `panel.ts`)
- `attachOtpIcons` → `attachCodeIcons`
- `observeNewOtpInputs` → `observeNewCodeInputs`

- [ ] **Step 1: Move the files with git mv**

```bash
git mv apps/extension/entrypoints/content/otp-target.ts apps/extension/entrypoints/content/code-target.ts
git mv apps/extension/entrypoints/content/otp-panel.ts apps/extension/entrypoints/content/code-panel.ts
git mv apps/extension/entrypoints/content/otp-icon.ts apps/extension/entrypoints/content/code-icon.ts
```

- [ ] **Step 2: Rename `OtpTarget` → `CodeTarget` inside `code-target.ts`**

Edit `apps/extension/entrypoints/content/code-target.ts`. Replace every occurrence of `OtpTarget` with `CodeTarget` (the file should only contain a single type export, so this is a one-line change at the top).

- [ ] **Step 3: Update `code-panel.ts` — symbols and imports**

Edit `apps/extension/entrypoints/content/code-panel.ts`:

1. Change the import on line 2 from `import type { OtpTarget } from "./otp-target";` to `import type { CodeTarget } from "./code-target";`
2. Replace every other `OtpTarget` in the file with `CodeTarget`.
3. Rename the exported function `showOtpPanel` → `showCodePanel` (around line 153).
4. Rename the exported function `hidePanel` → `hideCodePanel` (around line 197) and every internal call to it within `code-panel.ts` (lines 133, 154, 180, 189 per the original file).

- [ ] **Step 4: Update `code-icon.ts` — imports and symbols**

Edit `apps/extension/entrypoints/content/code-icon.ts`:

1. Line 1: change `import { showOtpPanel, hidePanel } from "./otp-panel";` to `import { showCodePanel, hideCodePanel } from "./code-panel";`.
2. Line 2: change `import type { OtpTarget } from "./otp-target";` to `import type { CodeTarget } from "./code-target";`.
3. Replace every `OtpTarget` in the file with `CodeTarget`.
4. Replace the call to `showOtpPanel(target, host)` (line 108) with `showCodePanel(target, host)`.
5. Replace the call to `hidePanel()` (line 137) with `hideCodePanel()`.
6. Rename the exported `attachOtpIcons` (line 152) → `attachCodeIcons` and the internal recursive reference (line 170, inside the debounce `setTimeout(attachOtpIcons, 300)`) accordingly.
7. Rename the exported `observeNewOtpInputs` → `observeNewCodeInputs`.

- [ ] **Step 5: Update `content.ts` — entrypoint import**

Edit `apps/extension/entrypoints/content.ts`:

1. Line 2: change `import { attachOtpIcons, observeNewOtpInputs } from "./content/otp-icon";` to `import { attachCodeIcons, observeNewCodeInputs } from "./content/code-icon";`.
2. Line 11 (and any other usages): replace `attachOtpIcons()` with `attachCodeIcons()`, and `observeNewOtpInputs()` with `observeNewCodeInputs()`.

- [ ] **Step 6: Verify no stragglers**

```bash
grep -rn "OtpTarget\|attachOtpIcons\|observeNewOtpInputs\|showOtpPanel\|otp-icon\|otp-panel\|otp-target" apps/extension
```

Expected: no output. If anything matches, edit that file to use the new symbol/path.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter extension typecheck
```

Expected: PASS.

- [ ] **Step 8: Build**

```bash
pnpm --filter extension build
```

Expected: PASS.

- [ ] **Step 9: Lint and format**

```bash
pnpm -w lint && pnpm -w format:check
```

- [ ] **Step 10: Commit**

```bash
git add apps/extension/entrypoints/content/code-target.ts \
        apps/extension/entrypoints/content/code-panel.ts \
        apps/extension/entrypoints/content/code-icon.ts \
        apps/extension/entrypoints/content.ts
git commit -m "refactor(extension): rename otp-* content files to code-*"
```

---

### Task 1: Wrangler config — Durable Object binding + migration

**Files:**

- Modify: `apps/worker/wrangler.toml`

- [ ] **Step 1: Add the DO binding and migration to wrangler.toml**

Append at the end of `apps/worker/wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "USER_CHANNEL"
class_name = "UserChannel"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["UserChannel"]
```

- [ ] **Step 2: Regenerate worker types**

```bash
pnpm --filter worker cf-typegen
```

Expected: `apps/worker/worker-configuration.d.ts` updates with a `USER_CHANNEL: DurableObjectNamespace<UserChannel>` entry. Typecheck will still fail because the class doesn't exist yet — that's fine, we ship it in Task 3.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/wrangler.toml apps/worker/worker-configuration.d.ts
git commit -m "feat(worker): bind UserChannel durable object"
```

---

### Task 2: Mercure SSE subscriber (via `eventsource-parser`)

**Files:**

- Modify: `apps/worker/package.json` (add `eventsource-parser`)
- Create: `apps/worker/src/services/mail-tm-mercure.ts`

We can't use the WHATWG `EventSource` shipped in Workers because it does not support custom request headers (needed for mail.tm Bearer auth). Instead we make a long-lived `fetch()` with `Authorization` and pipe the response body through [`eventsource-parser`](https://www.npmjs.com/package/eventsource-parser)'s `EventSourceParserStream` (used by Vercel AI SDK and OpenAI's clients). The library handles UTF-8 chunk boundaries, multi-line `data:` payloads, and `event:`/`id:`/`retry:` fields correctly — all of which a hand-rolled `split("\n\n")` would get subtly wrong.

- [ ] **Step 1: Install the dependency**

```bash
pnpm --filter worker add eventsource-parser
```

- [ ] **Step 2: Create the file**

Create `apps/worker/src/services/mail-tm-mercure.ts`:

```ts
import { EventSourceParserStream } from "eventsource-parser/stream";

const HUB = "https://mercure.mail.tm/.well-known/mercure";

export type MercureEvent =
  | { kind: "arrive"; messageId: string }
  | { kind: "seen"; messageId: string }
  | { kind: "delete"; messageId: string };

export interface MercureSubscriberOptions {
  /** mail.tm account id (the `providerAccountId` column on email_account). */
  accountId: string;
  /** mail.tm Bearer token (the `providerToken` column on email_account). */
  token: string;
  onEvent: (e: MercureEvent) => void | Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * Subscribes to a single mail.tm account's Mercure topic via a long-lived
 * fetch stream piped through `eventsource-parser`. Caller manages lifecycle:
 * `open()` to start, `close()` to stop. Errors during streaming are reported
 * via `onError`; the subscription does NOT auto-reconnect — the owning
 * Durable Object decides when to reopen via `activate`.
 */
export class MercureSubscriber {
  private controller: AbortController | null = null;
  private running = false;

  constructor(private readonly opts: MercureSubscriberOptions) {}

  open(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    void this.run(this.controller.signal);
  }

  close(): void {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
  }

  private async run(signal: AbortSignal): Promise<void> {
    const url = `${HUB}?topic=${encodeURIComponent(`/accounts/${this.opts.accountId}`)}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${this.opts.token}`,
        },
        signal,
      });
      if (!res.ok || !res.body) {
        this.opts.onError(new Error(`mercure connect failed: ${res.status}`));
        return;
      }
      const reader = res.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
        .getReader();
      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type !== "event") continue;
        await this.dispatch(value.data);
      }
    } catch (err) {
      if (this.running) this.opts.onError(err);
    } finally {
      this.running = false;
    }
  }

  private async dispatch(raw: string): Promise<void> {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      this.opts.onError(err);
      return;
    }
    // mail.tm emits an "Account" type event with account-level usage updates —
    // we only care about Message events (which carry an id and seen/isDeleted).
    if (data?.["@type"] === "Account") return;
    if (typeof data?.id !== "string") return;
    const kind: MercureEvent["kind"] = data.isDeleted ? "delete" : data.seen ? "seen" : "arrive";
    await this.opts.onEvent({ kind, messageId: data.id });
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: PASS.

- [ ] **Step 4: Lint and format**

```bash
pnpm -w lint && pnpm -w format:check
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/package.json apps/worker/src/services/mail-tm-mercure.ts pnpm-lock.yaml
git commit -m "feat(worker): mail.tm mercure SSE subscriber via eventsource-parser"
```

---

### Task 3: UserChannel Durable Object — skeleton with WS upgrade

This task creates the DO class with: WebSocket hibernation server, attachment-based per-socket state, RPC method stubs for `ensureSubscribed()` and `pushCode()`. The active/idle state machine and Mercure integration land in Task 4 and 5.

**Files:**

- Create: `apps/worker/src/durable-objects/user-channel.ts`
- Modify: `apps/worker/src/index.ts` (export the class)

- [ ] **Step 1: Create the DO file**

Create `apps/worker/src/durable-objects/user-channel.ts`:

```ts
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
```

- [ ] **Step 2: Export the DO class from the worker entry**

Edit `apps/worker/src/index.ts`. After the existing imports (after line 9), add:

```ts
export { UserChannel } from "./durable-objects/user-channel";
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: PASS.

- [ ] **Step 4: Build**

```bash
pnpm --filter worker build
```

Expected: PASS — `wrangler deploy --dry-run` succeeds, no migration errors.

- [ ] **Step 5: Lint and format**

```bash
pnpm -w lint && pnpm -w format:check
```

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/durable-objects/user-channel.ts apps/worker/src/index.ts
git commit -m "feat(worker): UserChannel DO skeleton with hibernating websocket"
```

---

### Task 4: Active/idle state machine with alarm-driven teardown

This adds the alarm handler and the `activate`/`deactivate` transitions to `UserChannel`. SSE subscriptions are _declared_ here (one per account) but the subscription bodies remain stubbed — Task 5 wires them to actually call back into `syncAccountInternal`.

**Critical gotcha (documented in the Cloudflare DO docs):** when an alarm wakes a hibernated DO, the constructor runs _before_ `alarm()`. If the constructor unconditionally re-arms the alarm, cleanup never fires. We must only set alarms from message handlers (`ensureSubscribed`, `webSocketMessage`), never from the constructor or `alarm` itself.

**Files:**

- Modify: `apps/worker/src/durable-objects/user-channel.ts`

- [ ] **Step 1: Add active/idle state and deactivate logic**

Replace the body of `apps/worker/src/durable-objects/user-channel.ts` with:

```ts
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: PASS.

- [ ] **Step 3: Build**

```bash
pnpm --filter worker build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/durable-objects/user-channel.ts
git commit -m "feat(worker): UserChannel active/idle state with alarm cleanup"
```

---

### Task 4b: Add `listActiveByUserId` to `EmailAccountService`

The DO needs to enumerate the user's active burners to subscribe their Mercure topics. Rather than dropping a raw drizzle query into the DO (a layer violation), add a service method we can call through the cached `ManagedRuntime`.

**Files:**

- Modify: `apps/worker/src/services/email-account.ts`

- [ ] **Step 1: Extend the service tag**

Edit `apps/worker/src/services/email-account.ts`. In the `EmailAccountService` `Context.Tag` declaration (lines 9–43), add the new method signature alongside the existing ones:

```ts
readonly listActiveByUserId: (
  userId: string,
) => Effect.Effect<
  ReadonlyArray<typeof schema.emailAccount.$inferSelect>,
  DatabaseError
>;
```

- [ ] **Step 2: Implement it inside `EmailAccountServiceLive`**

Add imports if missing (note: `or`, `isNull`, `gt` already aren't imported in this file — add them):

```ts
import { eq, and, or, isNull, gt } from "drizzle-orm";
```

Inside the returned service object, add:

```ts
listActiveByUserId: (userId: string) =>
  query(() =>
    db.query.emailAccount.findMany({
      where: and(
        eq(schema.emailAccount.userId, userId),
        or(
          isNull(schema.emailAccount.expiresAt),
          gt(schema.emailAccount.expiresAt, new Date()),
        ),
      ),
    }),
  ),
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/services/email-account.ts
git commit -m "feat(worker): EmailAccountService.listActiveByUserId"
```

---

### Task 5: Wire Mercure subscriptions in activate

Now we populate `activate` to enumerate the user's burner accounts (via the new service method from Task 4b), open a `MercureSubscriber` per account, and on each `arrive` event call back into `EmailMessageService.syncAccountInternal`. To avoid rebuilding the entire Effect service graph on every event, we cache a single `ManagedRuntime` as an instance field on the DO — created on activate, disposed on deactivate.

**Files:**

- Modify: `apps/worker/src/durable-objects/user-channel.ts`

- [ ] **Step 1: Add Mercure wiring + cached ManagedRuntime**

Edit `apps/worker/src/durable-objects/user-channel.ts`.

Add these imports near the top of the file (after the existing `MercureSubscriber` import):

```ts
import { Effect, ManagedRuntime } from "effect";
import type { Layer } from "effect";
import * as schema from "../db/schema";
import { makeServicesLayer } from "../runtime";
import { EmailAccountService } from "../services/email-account";
import { EmailMessageService } from "../services/email-message";
```

Add a typed alias and an instance field for the cached runtime. Inside the `UserChannel` class, alongside `private subscribers = new Map<...>()` and `private active = false`, add:

```ts
private runtime: ManagedRuntime.ManagedRuntime<
  Layer.Layer.Success<ReturnType<typeof makeServicesLayer>>,
  never
> | null = null;
```

Replace the existing `activate` method with:

```ts
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
```

Add the event handler as a separate method so the Mercure callback stays readable:

```ts
private async handleMercureEvent(
  account: typeof schema.emailAccount.$inferSelect,
  event: import("../services/mail-tm-mercure").MercureEvent,
): Promise<void> {
  if (event.kind !== "arrive") return;
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
}
```

Update `deactivate` to dispose the runtime:

```ts
private async deactivate(): Promise<void> {
  this.active = false;
  for (const sub of this.subscribers.values()) sub.close();
  this.subscribers.clear();
  if (this.runtime) {
    await this.runtime.dispose();
    this.runtime = null;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: PASS.

- [ ] **Step 3: Build**

```bash
pnpm --filter worker build
```

Expected: PASS.

- [ ] **Step 4: Lint and format**

```bash
pnpm -w lint && pnpm -w format:check
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/durable-objects/user-channel.ts
git commit -m "feat(worker): UserChannel subscribes to mail.tm mercure per account"
```

---

### Task 6: HTTP route `/api/channel/connect` — auth + DO upgrade

The extension hits `wss://api.example/api/channel/connect` to open the WS. The parent Worker authenticates the session via Better Auth, derives `userId`, and forwards the Upgrade to `env.USER_CHANNEL.idFromName(userId)` with `X-User-Id` set.

**Files:**

- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Insert the channel route**

Edit `apps/worker/src/index.ts`. After the existing auth route branch (currently `if (url.pathname.startsWith("/api/auth/"))` ending around line 38) and before the HttpApi handler (line 40), add:

```ts
if (url.pathname === "/api/channel/connect") {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response("unauthorized", { status: 401, headers: cors });
  }
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("expected websocket", { status: 426, headers: cors });
  }
  const id = env.USER_CHANNEL.idFromName(session.user.id);
  const stub = env.USER_CHANNEL.get(id);
  const forwarded = new Request(request, {
    headers: new Headers(request.headers),
  });
  forwarded.headers.set("X-User-Id", session.user.id);
  return stub.fetch(forwarded);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: PASS. If `auth.api.getSession` signature differs (Better Auth versions vary), check `apps/worker/src/auth.ts` and use the same call shape used in `apps/worker/src/middleware.ts` for session retrieval.

- [ ] **Step 3: Build**

```bash
pnpm --filter worker build
```

Expected: PASS. (End-to-end + curl smoke testing of this route is consolidated in Task 13.)

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): /api/channel/connect routes ws upgrade to UserChannel"
```

---

### Task 7: UserChannels Effect tag + runtime wiring

Create a dedicated module for the `UserChannels` Context.Tag. It's consumed by both `ExtractionService` (Task 7b) and `EmailAccountService` (Task 8), so it doesn't belong inside either service file.

**Files:**

- Create: `apps/worker/src/services/user-channel.ts`
- Modify: `apps/worker/src/runtime.ts`

- [ ] **Step 1: Create the tag module**

Create `apps/worker/src/services/user-channel.ts`:

```ts
import { Context } from "effect";
import type { UserChannel } from "../durable-objects/user-channel";

export class UserChannels extends Context.Tag("UserChannels")<
  UserChannels,
  DurableObjectNamespace<UserChannel>
>() {}
```

- [ ] **Step 2: Provide the layer in runtime.ts**

Edit `apps/worker/src/runtime.ts`.

Add the import at the top alongside the other service imports (after the existing `MailTmLive` line):

```ts
import { UserChannels } from "./services/user-channel";
```

In `makeServicesLayer`, after `const aiLayer = Layer.succeed(WorkersAi, env.AI);` (line 21), add:

```ts
const userChannelLayer = Layer.succeed(UserChannels, env.USER_CHANNEL);
```

(`userChannelLayer` will be provided to specific services in Tasks 7b and 8 — not added to the top-level `Layer.mergeAll`.)

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/services/user-channel.ts apps/worker/src/runtime.ts
git commit -m "feat(worker): UserChannels context tag and runtime layer"
```

---

### Task 7b: Push from extraction service to UserChannel

When `ExtractionService.extractForMessage` finishes writing `extractedCode` + `extractionStatus="done"`, it now also calls `userChannels.idFromName(userId).get().pushCode(...)`. The `userId` is looked up via the message's `emailAccountId → emailAccount.userId` join.

**Files:**

- Modify: `apps/worker/src/services/extraction.ts`
- Modify: `apps/worker/src/runtime.ts`

- [ ] **Step 1: Import the tag and inject it into ExtractionServiceLive**

Edit `apps/worker/src/services/extraction.ts`.

Add to the imports:

```ts
import { UserChannels } from "./user-channel";
```

Inside the `Effect.gen` for `ExtractionServiceLive`, after `const ai = yield* WorkersAi;`, add:

```ts
const userChannels = yield * UserChannels;
```

- [ ] **Step 2: Look up userId and push after extraction completes**

In `extractForMessage`, after the existing `db.update(...).set({ extractedCode: code, extractionStatus: "done" })` block (line 107 in the unchanged file), add:

```ts
const acct =
  yield *
  query(() =>
    db.query.emailAccount.findFirst({
      where: eq(schema.emailAccount.id, message.emailAccountId),
      columns: { userId: true },
    }),
  );
const userId = acct?.userId;
if (userId) {
  yield *
    Effect.tryPromise({
      try: () =>
        userChannels.get(userChannels.idFromName(userId)).pushCode({
          accountId: message.emailAccountId,
          messageId,
          code,
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.catchAll((cause) => Effect.logError(`pushCode failed for ${messageId}: ${cause}`)),
    );
}
```

Note: `userId` is captured as a `const` _outside_ the `tryPromise.try` closure. This is intentional — TypeScript's narrowing from `if (userId)` doesn't always carry into the closure, so we lock in the non-null value first.

- [ ] **Step 3: Provide the UserChannels layer to extractionLayer**

Edit `apps/worker/src/runtime.ts`. Update the `extractionLayer` composition (currently lines 36–39) to include `userChannelLayer`:

```ts
const extractionLayer = ExtractionServiceLive.pipe(
  Layer.provide(dbLayer),
  Layer.provide(aiLayer),
  Layer.provide(userChannelLayer),
);
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: PASS.

- [ ] **Step 5: Build**

```bash
pnpm --filter worker build
```

Expected: PASS.

- [ ] **Step 6: Lint and format**

```bash
pnpm -w lint && pnpm -w format:check
```

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/services/extraction.ts apps/worker/src/runtime.ts
git commit -m "feat(worker): push extracted code to UserChannel"
```

---

### Task 8: Activate UserChannel on burner creation

When `EmailAccountService.create` finishes inserting a new burner, fire-and-forget `ensureSubscribed()` on the user's channel. This opens the Mercure subscription immediately so the first email (often carrying the verification code) is pushed in real time.

**Files:**

- Modify: `apps/worker/src/services/email-account.ts`
- Modify: `apps/worker/src/runtime.ts`

- [ ] **Step 1: Inject UserChannels into EmailAccountServiceLive**

Edit `apps/worker/src/services/email-account.ts`.

Add to imports:

```ts
import { UserChannels } from "./user-channel";
```

Inside `EmailAccountServiceLive`'s `Effect.gen`, after `const mailTm = yield* MailTm;` (line 49), add:

```ts
const userChannels = yield * UserChannels;
```

In the `create` method, after `yield* query(() => db.insert(schema.emailAccount).values(row));` (line 92) and before `return row;`, add:

```ts
yield *
  Effect.tryPromise({
    try: () => userChannels.get(userChannels.idFromName(userId)).ensureSubscribed(),
    catch: (cause) => cause,
  }).pipe(
    Effect.catchAll((cause) => Effect.logError(`ensureSubscribed failed for ${userId}: ${cause}`)),
  );
```

- [ ] **Step 2: Provide the UserChannels layer to emailAccountLayer**

Edit `apps/worker/src/runtime.ts`. Update the `emailAccountLayer` composition (currently lines 24–27) to include `userChannelLayer`:

```ts
const emailAccountLayer = EmailAccountServiceLive.pipe(
  Layer.provide(dbLayer),
  Layer.provide(mailTmLayer),
  Layer.provide(userChannelLayer),
);
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: PASS.

- [ ] **Step 4: Build**

```bash
pnpm --filter worker build
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/services/email-account.ts apps/worker/src/runtime.ts
git commit -m "feat(worker): activate UserChannel on burner creation"
```

---

### Task 9: Extension UserChannelClient (wrapper over `partysocket`)

[`partysocket`](https://github.com/cloudflare/partykit/tree/main/packages/partysocket) is Cloudflare's WebSocket client library. It already implements WebSocket-API-compatible reconnect (exponential backoff) and **message buffering while disconnected** — replays anything we `.send()` while offline once it reconnects. We add an application-level 25 s heartbeat on top (`partysocket`'s built-in pingTimeout uses WS ping frames, which the DO's hibernation auto-response would handle without waking — wrong shape for our heartbeat).

The message-buffering matters: if the WS briefly drops between the content script firing `CODE_DETECTED` and the server delivering `ready`, `partysocket` replays the queued `{type:"subscribe"}` after reconnect rather than losing the signal.

**Files:**

- Modify: `apps/extension/package.json` (add `partysocket`)
- Create: `apps/extension/lib/user-channel-client.ts`

- [ ] **Step 1: Install the dependency**

```bash
pnpm --filter extension add partysocket
```

- [ ] **Step 2: Create the client**

`partysocket` ships two entry points: the `PartySocket` class (constructs URLs as `wss://<host>/parties/<party>/<room>` — for the PartyKit convention) and a `WebSocket` named export which is a **drop-in reconnecting WebSocket** that takes any URL string. Our route is a fixed `/api/channel/connect` resolved by session cookie, so the drop-in `WebSocket` is the correct entry point.

Create `apps/extension/lib/user-channel-client.ts`:

```ts
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

    this.ws = new ReconnectingWebSocket(this.opts.url, [], {
      maxRetries: Infinity,
      minReconnectionDelay: 1_000,
      maxReconnectionDelay: 30_000,
      reconnectionDelayGrowFactor: 1.5,
      // We use an application-level heartbeat (regular message, not a WS
      // ping frame) so the DO actually wakes from hibernation. partysocket's
      // built-in pingTimeout uses ping frames — wrong shape for our case.
    });

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
```

If the named export is found at a different path in the installed version (older builds exported it from `partysocket/ws`), update the import accordingly — the constructor signature `new WebSocket(url, protocols, options)` is stable.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter extension typecheck
```

Expected: PASS.

- [ ] **Step 4: Lint and format**

```bash
pnpm -w lint && pnpm -w format:check
```

- [ ] **Step 5: Commit**

```bash
git add apps/extension/package.json apps/extension/lib/user-channel-client.ts pnpm-lock.yaml
git commit -m "feat(extension): user-channel client over partysocket"
```

---

### Task 10: Wire background.ts to UserChannelClient

Background opens the client after sign-in, bridges `CODE_DETECTED` chrome messages into WS `subscribe` pings, and broadcasts inbound `ready`/`message` events to popup + content scripts via `chrome.runtime.sendMessage`.

**Files:**

- Modify: `apps/extension/entrypoints/background.ts`

- [ ] **Step 1: Add client bootstrap and chrome message bridging**

Edit `apps/extension/entrypoints/background.ts`. Add to the imports at the top:

```ts
import { UserChannelClient, type ChannelOutbound } from "@/lib/user-channel-client";
```

In the `MessageMap` type (around line 30), add:

```ts
CODE_DETECTED: {
  type: "CODE_DETECTED";
}
```

Replace the section that calls `ensureAnonymousSession().catch(...)` (around line 52) with:

```ts
let channel: UserChannelClient | null = null;

function startChannel(): void {
  if (channel) return;
  const wsUrl = API_URL.replace(/^http/, "ws") + "/api/channel/connect";
  channel = new UserChannelClient({
    url: wsUrl,
    onMessage: (msg: ChannelOutbound) => {
      // Broadcast every push to popup + content scripts. Receivers filter
      // by `type` themselves.
      chrome.runtime.sendMessage({ type: "CHANNEL_PUSH", payload: msg }).catch(() => {
        // No receiver listening — that's fine.
      });
    },
    onStateChange: (state) => console.log(`[user-channel] ${state}`),
  });
  channel.connect();
}

ensureAnonymousSession()
  .then(() => startChannel())
  .catch((err) => console.error(err));
```

In the `onMessage` switch, add a new case alongside the existing ones:

```ts
case "CODE_DETECTED": {
  channel?.subscribe();
  sendResponse({ status: true });
  break;
}
```

- [ ] **Step 2: Send a subscribe hint on successful GENERATE_EMAIL**

Still in `apps/extension/entrypoints/background.ts`, find the existing `case "GENERATE_EMAIL"` block (around line 66–69). After `sendResponse(res);` add:

```ts
if (res.status) channel?.subscribe();
```

This is belt-and-braces: the worker already calls `ensureSubscribed()` server-side on burner creation, but the local WS hint also re-extends the active window from the client side without waiting for the worker→DO RPC.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter extension typecheck
```

Expected: PASS.

- [ ] **Step 4: Build the extension**

```bash
pnpm --filter extension build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/background.ts
git commit -m "feat(extension): bootstrap user-channel ws in background worker"
```

---

### Task 11: Content script — send CODE_DETECTED on detection

When the content script attaches a code icon to a target on the page, send a `CODE_DETECTED` chrome message to background once per page. Background turns this into a WS `subscribe` ping that opens the Mercure subscription on the server even if the user hasn't opened the popup.

**Files:**

- Modify: `apps/extension/entrypoints/content/code-icon.ts`

- [ ] **Step 1: Add a one-shot CODE_DETECTED sender**

In `apps/extension/entrypoints/content/code-icon.ts`, just after the `const attached = ...` line (line 7), add:

```ts
let codeDetectedSent = false;
```

Modify `attachCodeIcons` (line 152 in the renamed file) to fire `CODE_DETECTED` the first time any target is attached on this page:

```ts
export function attachCodeIcons() {
  for (const [anchor, host] of attached) {
    if (!document.contains(anchor)) {
      host.remove();
      attached.delete(anchor);
    }
  }
  const targets = findCodeTargets();
  if (!codeDetectedSent && targets.length > 0) {
    codeDetectedSent = true;
    try {
      void chrome.runtime.sendMessage({ type: "CODE_DETECTED" });
    } catch {
      // background not ready / extension reloading — best-effort
    }
  }
  for (const target of targets) {
    if (attached.has(target.anchor)) continue;
    attached.set(target.anchor, createIcon(target));
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter extension typecheck
```

Expected: PASS.

- [ ] **Step 3: Build the extension**

```bash
pnpm --filter extension build
```

- [ ] **Step 4: Lint and format**

```bash
pnpm -w lint && pnpm -w format:check
```

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/content/code-icon.ts
git commit -m "feat(extension): fire CODE_DETECTED when content script finds code field"
```

---

### Task 12: Popup invalidates query on CHANNEL_PUSH

When the background broadcasts a `CHANNEL_PUSH` with `payload.type === "ready"`, the popup should refresh its cached `latest-code` and `messages` queries so the UI updates without a manual refresh click.

**Files:**

- Modify: `apps/extension/entrypoints/popup/main.tsx` (or wherever the `QueryClient` is constructed; verify in Step 1).

- [ ] **Step 1: Locate the QueryClient setup**

```bash
grep -rn "new QueryClient" apps/extension/entrypoints/popup
```

Expected: finds the file constructing `QueryClient` — typically `main.tsx` or similar. Note the file path for Step 2.

- [ ] **Step 2: Listen for CHANNEL_PUSH and invalidate**

In the file from Step 1, near the `QueryClient` instantiation, add:

```ts
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "CHANNEL_PUSH") return;
  const payload = msg.payload as { type?: string; accountId?: string };
  if (payload?.type === "ready" || payload?.type === "message") {
    queryClient.invalidateQueries({ queryKey: ["latest-code"] });
    if (payload.accountId) {
      queryClient.invalidateQueries({ queryKey: ["messages", payload.accountId] });
    }
    queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
  }
});
```

If the precise query keys differ from `["latest-code"]` / `["messages", accountId]` / `["email-accounts"]` (check `apps/extension/entrypoints/popup/hooks/use-api.ts`), adjust to match — the names must line up exactly with what the hooks pass to `useQuery`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter extension typecheck
```

Expected: PASS.

- [ ] **Step 4: Build**

```bash
pnpm --filter extension build
```

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/popup/main.tsx  # (or the file you edited)
git commit -m "feat(extension): invalidate queries on user-channel push"
```

---

### Task 13: End-to-end smoke test

Run the system end-to-end and confirm code latency dropped from "user must click Refresh" to "code appears within a few seconds of email arrival."

**Files:** none

- [ ] **Step 1: Start dev servers**

```bash
pnpm dev
```

Watch for:

- Worker log: `[user-channel] connecting` then `open` after the extension loads.
- No exceptions in the worker tail.

- [ ] **Step 1b: Curl the WS upgrade route (unauthenticated)**

Verify `/api/channel/connect` rejects requests without a session cookie:

```bash
curl -i -N \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:8787/api/channel/connect
```

Expected: `HTTP/1.1 401 Unauthorized`.

- [ ] **Step 1c: Curl the WS upgrade route (authenticated)**

Grab a session cookie (sign in once via the extension, copy the `better-auth.*` cookie from DevTools), then:

```bash
curl -i -N \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Cookie: <paste-cookie-here>" \
  http://localhost:8787/api/channel/connect
```

Expected: `HTTP/1.1 101 Switching Protocols`.

- [ ] **Step 2: Reload the unpacked extension**

In Chrome: `chrome://extensions` → reload the burner-kit extension → open the popup.

In the popup, generate a new burner. Watch the worker logs — you should see an `ensureSubscribed` log line shortly after the `GENERATE_EMAIL` request and a Mercure subscription opening.

- [ ] **Step 3: Send a test email**

From any other mail client (or `curl` mail.tm's send-via-burner endpoint if you have one set up), send a short email containing a 6-digit code to the burner address.

Within ~1–3 s after the email lands at mail.tm, you should see in the worker logs:

1. `[user-channel]` log of an `arrive` event.
2. `extraction for <id>: code=<value>`
3. `pushCode` over RPC.

In the popup, the message list should auto-refresh and the code should be visible without clicking Refresh.

- [ ] **Step 4: Test the code autofill icon path**

Open any signup form that asks for a code (or a contrived `<input autocomplete="one-time-code">` test page). The content script attaches an icon and `CODE_DETECTED` fires once. Confirm via worker logs that an extra `subscribe` ping arrives at the DO.

- [ ] **Step 5: Verify idle-window fallback**

Close the popup. Wait > 90 s. Confirm in the worker logs that the DO alarm fires and `deactivate` runs (Mercure subscriptions close). Send another test email; the 1-minute cron should pick it up within 60 s and the next popup open should display the code via the existing REST path.

- [ ] **Step 6: Final build sanity**

```bash
pnpm -w typecheck && pnpm -w lint && pnpm -w format:check && pnpm -w build
```

Expected: all green.

- [ ] **Step 7: Done — no commit (smoke test only)**

If any step in this task fails, debug it before moving on. Common gotchas:

- **No `hello` frame received** → check that connect URL uses `ws://` not `http://` (background.ts replaces `http`→`ws`).
- **DO alarm never fires** → make sure no path in `deactivate` or `alarm()` calls `setAlarm` again; per Cloudflare docs that re-arms indefinitely.
- **Mercure connect 401** → verify `providerToken` is set on the burner row and that the bearer header is actually being sent (the SSE reader uses `fetch` with explicit `Authorization` — not browser EventSource, which strips headers).

---

## Self-Review

**Spec coverage:**

- Active/idle state machine with heartbeat-extends-alarm → Tasks 3, 4.
- Wire protocol typed and validated with Effect Schema → Tasks 3, 4.
- Mercure SSE subscriber via `eventsource-parser` to support Bearer auth → Task 2.
- `EmailAccountService.listActiveByUserId` keeps D1 access in the service layer → Task 4b.
- DO uses existing `syncAccountInternal` for fetch+extract on each Mercure arrival → Task 5.
- DO RPC `pushCode` called by extraction service after AI completes → Task 7b.
- Codebase standardizes on "code" (matches `extractedCode`, `/api/codes/latest`, `GET_LATEST_CODE`, `CODE_EXTRACTION_QUEUE`). Task 0 renames the legacy `otp-*` content files and `Otp*` symbols up front; the rest of the plan uses the renamed names.
- DO RPC `ensureSubscribed` called on burner creation → Task 8.
- HTTP route `/api/channel/connect` with session auth → Task 6.
- Extension WS client via `partysocket` (reconnect + message buffering) with application-level 25 s heartbeat → Task 9.
- Extension background bridges chrome ↔ WS, broadcasts pushes → Task 10.
- Content script signals `CODE_DETECTED` on detection → Task 11.
- Popup invalidates queries on push → Task 12.
- 1-minute cron retained as idle-window safety net → confirmed in Out-of-scope and Task 13 Step 5.
- End-to-end smoke test → Task 13.

**Effect / Cloudflare audit:**

- `UserChannels` lives in its own module (`services/user-channel.ts`) — it's consumed by two services, doesn't belong inside either. Matches the pattern of `CodeQueue`/`WorkersAi` (which are in `extraction.ts` because only `extraction.ts` consumes them).
- The DO caches a single `ManagedRuntime` instance, created on `activate`, disposed on `deactivate`. Per-event runtime construction would rebuild the entire service graph (drizzle, auth, mailtm http client, etc.) on every Mercure arrival.
- `Effect.tryPromise` blocks use bare promise-returning thunks (`() => stub.foo()`) instead of `async () => { await stub.foo() }` since RPC methods already return promises.
- Closure narrowing in the extraction push: `userId` is captured as a `const` _outside_ the `tryPromise.try` closure so TypeScript can lock in the non-null narrowing.
- `userChannelLayer` is provided to specific services (`extractionLayer`, `emailAccountLayer`) via `Layer.provide`, not merged at the top level. Matches the existing pattern for service-specific dependencies like `codeQueueLayer`.
- `syncAccountInternal` returns `Effect<void, DatabaseError>`. The Mercure event handler wraps it with `Effect.catchAll(... Effect.logError ...)` so a sync failure logs but does not reject the runtime promise.
- Wire protocol uses Effect `Schema` (`Schema.Union` + `Schema.decodeUnknownEither`) instead of `as` casts. Malformed inbound messages are dropped silently without throwing.
- `EmailAccountService.listActiveByUserId` (Task 4b) keeps D1 access in the service layer; the DO calls it through its cached `ManagedRuntime`. No raw drizzle inside the DO.
- SSE parsing delegated to `eventsource-parser` (used by Vercel AI SDK / OpenAI clients). Handles UTF-8 chunk boundaries, multi-line `data:`, `event:`/`id:`/`retry:` fields — all of which a hand-rolled `split("\n\n")` would get subtly wrong.
- WebSocket client delegated to `partysocket` (Cloudflare-maintained). Provides reconnect + message buffering; we layer a regular-message heartbeat on top so the DO actually wakes from hibernation (a WS `ping` frame would auto-respond without waking).
- DO RPC pattern (`extends DurableObject<Env>`, public methods as RPC) is the 2024-04-03+ idiom. All call sites `await` the stub method to avoid swallowed errors / lost return values per Cloudflare's docs.

**Placeholder scan:** all code blocks contain runnable code. No "TBD", "implement later", or "similar to Task N" anywhere.

**Type consistency:**

- `ChannelOutbound` / `ChannelInbound` are defined identically in `user-channel.ts` (worker) and `user-channel-client.ts` (extension).
- `UserChannels` tag is created once in `services/user-channel.ts` and imported by `runtime.ts`, `extraction.ts`, and `email-account.ts`.
- RPC method names match between caller and callee: `ensureSubscribed`, `pushCode`.
- Chrome message names match between sender and receiver: `CODE_DETECTED`, `CHANNEL_PUSH`.
- WS message `type` values match between client (`user-channel-client.ts`) and server (`user-channel.ts`): `heartbeat`, `subscribe`, `hello`, `ready`, `message`.

**Known fragility:**

- The DO trusts `X-User-Id` injected by the parent Worker. Anyone able to call the DO directly (bypassing the Worker) could impersonate a user — but DO stubs are only obtainable from same-script bindings, so this is safe.
- Mercure's bearer token lives in D1; if it rotates server-side we don't catch it until the SSE 401s. The retry path is to close+reopen on the next heartbeat-driven `activate`. Fine for MVP; monitor in prod.
- Cloudflare cuts WebSockets after **100 s** of zero traffic in either direction (Free + Pro plans). Two related constants must stay in the right order: `HEARTBEAT_MS` (extension, currently 25_000) < `ACTIVE_TTL_MS` (worker DO, currently 90_000) < 100_000 (Cloudflare's hard limit). If you raise `HEARTBEAT_MS` past ~80 s, the WS will start dropping silently. If you raise `ACTIVE_TTL_MS` past 100 s, the alarm won't fire before Cloudflare disconnects the socket — but the DO still works, just less efficiently.
