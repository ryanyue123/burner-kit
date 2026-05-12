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

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Subscribes to a single mail.tm account's Mercure topic via a long-lived
 * fetch stream piped through `eventsource-parser`. Caller manages lifecycle:
 * `open()` to start, `close()` to stop. Errors during streaming are reported
 * via `onError`; the subscriber auto-reconnects with exponential backoff
 * (1 s → 30 s capped) and resumes via `Last-Event-ID` so events missed in
 * the gap are replayed by the hub. Only `close()` stops the loop.
 */
export class MercureSubscriber {
  private controller: AbortController | null = null;
  private running = false;
  private lastEventId: string | null = null;

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
    let backoff = 0;
    while (this.running && !signal.aborted) {
      if (backoff > 0) {
        try {
          await new Promise((r) => setTimeout(r, backoff));
        } catch {
          // unreachable; setTimeout doesn't throw
        }
        if (!this.running || signal.aborted) return;
      }
      try {
        const headers: Record<string, string> = {
          Accept: "text/event-stream",
          Authorization: `Bearer ${this.opts.token}`,
        };
        if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId;

        const res = await fetch(url, { headers, signal });
        if (!res.ok || !res.body) {
          throw new Error(`mercure connect failed: ${res.status}`);
        }
        backoff = 0; // reset on successful connect

        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(new EventSourceParserStream())
          .getReader();
        while (this.running) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.id) this.lastEventId = value.id;
          await this.dispatch(value.data);
        }
        // Stream ended cleanly (server closed). Loop and reconnect with
        // a short delay to avoid spinning if the server is rejecting.
        backoff = INITIAL_BACKOFF_MS;
      } catch (err) {
        if (!this.running || signal.aborted) return;
        this.opts.onError(err);
        backoff = backoff === 0 ? INITIAL_BACKOFF_MS : Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
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
