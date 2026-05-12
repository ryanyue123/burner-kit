import { Effect, Schedule, Fiber, Schema } from "effect";
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

// Shape of a Message-resource payload pushed via Mercure. mail.tm also emits
// an "Account" event for usage updates — we filter those out by `@type`.
const MercureMessage = Schema.Struct({
  id: Schema.String,
  isDeleted: Schema.optional(Schema.Boolean),
  seen: Schema.optional(Schema.Boolean),
  "@type": Schema.optional(Schema.String),
});
const decodeMercureMessage = Schema.decodeUnknownEither(MercureMessage);

async function dispatch(opts: MercureSubscriberOptions, raw: string): Promise<void> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    opts.onError(err);
    return;
  }
  const result = decodeMercureMessage(json);
  if (result._tag === "Left") return; // not a message we recognise — drop silently
  const data = result.right;
  if (data["@type"] === "Account") return;
  const kind: MercureEvent["kind"] = data.isDeleted ? "delete" : data.seen ? "seen" : "arrive";
  await opts.onEvent({ kind, messageId: data.id });
}

/** Exponential backoff capped at 30 s — `either` returns the shorter delay. */
const reconnectBackoff = Schedule.exponential("1 second", 2).pipe(
  Schedule.either(Schedule.spaced("30 seconds")),
);

/**
 * Subscribes to a single mail.tm account's Mercure topic and resumes
 * automatically on error using `Last-Event-ID`. Backoff: 1 s → 2 s → 4 s
 * → … → 30 s cap. Runs until interrupted (`close()`).
 */
function subscribeEffect(opts: MercureSubscriberOptions) {
  let lastEventId: string | null = null;
  const url = `${HUB}?topic=${encodeURIComponent(`/accounts/${opts.accountId}`)}`;

  const runOnce = Effect.tryPromise({
    try: async (signal) => {
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        Authorization: `Bearer ${opts.token}`,
      };
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;

      const res = await fetch(url, { headers, signal });
      if (!res.ok || !res.body) throw new Error(`mercure connect failed: ${res.status}`);

      const reader = res.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
        .getReader();
      signal.addEventListener("abort", () => void reader.cancel().catch(() => {}));

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value.id) lastEventId = value.id;
        await dispatch(opts, value.data);
      }
    },
    catch: (e) => e,
  });

  return runOnce.pipe(
    Effect.tapError((e) => Effect.sync(() => opts.onError(e))),
    Effect.retry(reconnectBackoff),
    Effect.ignore, // we've already reported the error; runtime needn't see it
  );
}

/**
 * Thin class wrapper over the Effect-based subscriber so the DO can still
 * use `open()` / `close()` to manage a Map of subscribers per account.
 */
export class MercureSubscriber {
  private fiber: Fiber.RuntimeFiber<void, never> | null = null;

  constructor(private readonly opts: MercureSubscriberOptions) {}

  open(): void {
    if (this.fiber) return;
    this.fiber = Effect.runFork(subscribeEffect(this.opts));
  }

  close(): void {
    if (!this.fiber) return;
    Effect.runFork(Fiber.interrupt(this.fiber));
    this.fiber = null;
  }
}
