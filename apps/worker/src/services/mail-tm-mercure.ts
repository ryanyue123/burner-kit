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
