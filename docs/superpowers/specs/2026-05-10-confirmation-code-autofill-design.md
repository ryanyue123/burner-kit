# Confirmation Code Autofill

## Overview

When a confirmation/verification code arrives in a burner inbox, extract it server-side and surface it for one-click use. The user shouldn't have to open the email, find the code, select it, and paste it — the popup shows the code at a glance, and on signup pages the existing "B" content-script pattern fills it automatically.

This builds on the existing burner-email autofill: same `B` icon convention, same content-script architecture, same popup shell. The new piece is server-side extraction (Workers AI), an async extraction pipeline (Cloudflare Queues), a freshness mechanism (Cron Trigger), and UI surfaces for the extracted code.

## Goals

- A code that arrives in the inbox is extracted within ~60 seconds without any user action.
- In the popup, a message containing a code shows the code prominently with a single-click copy.
- On a signup page, when the user focuses a one-time-code input, the existing `B` icon appears; clicking fills the latest code.
- Auto-copy: when the user opens the popup and there is a recently-arrived (<5 min) unread code, copy it to the clipboard silently.

## Non-Goals

- Multiple codes per message. v1 stores one extracted value per message; if a message contains two codes, the model picks the one most clearly labeled as a verification/confirmation code (see the prompt).
- Magic-link extraction, generic email summarization, or any other LLM-driven feature. Code extraction only.
- Mercure / Durable-Object real-time push. Considered and rejected on cost grounds — see [Architecture decisions](#architecture-decisions).
- A regex fast-path. Considered and rejected — see [Architecture decisions](#architecture-decisions).
- Multi-code clipboard history. Latest code wins.

## Architecture

```
   ┌──────────────────────────┐
   │   Cron Trigger (1 min)   │  iterates non-expired email_account rows
   └─────────────┬────────────┘
                 │
   ┌─────────────┼────────────┐
   │  Popup open │            │
   └─────────────┼────────────┘
                 ▼
   ┌──────────────────────────┐
   │    syncAndList(...)      │
   │    - fetch MailTm        │
   │    - upsert emailMessage │
   │    - enqueue per new msg │
   └─────────────┬────────────┘
                 ▼
   ┌──────────────────────────┐
   │  OTP_EXTRACTION_QUEUE    │   Cloudflare Queue
   └─────────────┬────────────┘
                 ▼
   ┌──────────────────────────┐
   │  consumer (batched)      │
   │  env.AI.run(glm-4.7)     │
   │  UPDATE emailMessage     │
   └──────────────────────────┘
```

There is one extraction path. Whether sync was triggered by cron, popup-open, or any future caller, new messages flow through the same producer and the same consumer. This keeps the surface small.

## Components

### 1. Schema delta

Add two columns to `emailMessage` (in `apps/worker/src/db/schema.ts`):

```ts
extractedCode: text("extracted_code"),                        // nullable
extractionStatus: text("extraction_status")
  .default("pending")
  .notNull(),                                                 // 'pending' | 'done' | 'failed'
```

Migration: `pnpm --filter worker drizzle-kit generate` and apply.

`extractionStatus = 'done'` with `extractedCode = NULL` means "we looked and there's no code." `'failed'` means the AI call errored after retries. `'pending'` is the initial state.

### 2. Extraction queue

Cloudflare Queue (binding `OTP_EXTRACTION_QUEUE`) configured in `wrangler.toml`:

```toml
[[queues.producers]]
queue = "otp-extraction"
binding = "OTP_EXTRACTION_QUEUE"

[[queues.consumers]]
queue = "otp-extraction"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "otp-extraction-dlq"
```

Message shape: `{ messageId: string }`. The consumer re-reads the full message body from D1 — keeps queue payloads small and avoids stale data if the message is updated between enqueue and processing.

### 3. Producer

In `EmailMessageService.syncAndList`, after each `INSERT` of a new message, enqueue:

```ts
await env.OTP_EXTRACTION_QUEUE.send({ messageId: msg.id });
```

Only enqueue for _newly inserted_ rows. The content-backfill branch (when `existing.textContent === null`) should also enqueue, since the row exists but had no body to extract from before.

### 4. Consumer

New handler in `apps/worker/src/index.ts`:

```ts
export default {
  fetch: appFetchHandler,
  scheduled: cronHandler,
  queue: extractionQueueHandler,
};
```

`extractionQueueHandler(batch, env)` processes the batch in parallel:

1. Read each message from D1 by ID.
2. Skip if `extractionStatus === 'done'` (idempotency for retries).
3. Call `env.AI.run('@cf/zai-org/glm-4.7-flash', { ... })` with a constrained prompt (see [Prompt](#prompt)).
4. Parse the model response; set `extractedCode` (or NULL) and `extractionStatus = 'done'`.
5. On error, throw to trigger Cloudflare's automatic retry. After `max_retries` retries are exhausted, the message lands in the DLQ. The row itself stays `extractionStatus = 'pending'` — a future DLQ consumer can flip it to `'failed'`. v1 ships without a DLQ consumer; failed rows are visible to operators in the CF dashboard.

### 5. Cron trigger

In `wrangler.toml`:

```toml
[triggers]
crons = ["*/1 * * * *"]
```

`scheduled(event, env)` handler iterates `emailAccount` rows where `expiresAt > now()` (or `expiresAt IS NULL`) and calls `syncAndList` for each. Same code path as popup-triggered sync, so new messages get enqueued the same way.

To run sync from cron we need an entrypoint that doesn't require a user-context HTTP request. Either:

- Refactor `EmailMessageService.syncAndList` to take `(userId, accountId)` already which it does — cron just iterates `(userId, accountId)` pairs from a DB query.
- Or add a thin `syncAccountInternal(accountId)` that loads userId from the account row.

Pick whichever fits the Effect-based service style; both are equivalent for our purposes.

### 6. Prompt and structured output

Use Workers AI's OpenAI-compatible `response_format` to force valid JSON:

```ts
await env.AI.run("@cf/zai-org/glm-4.7-flash", {
  messages: [
    {
      role: "system",
      content:
        "You extract one-time confirmation codes from emails. " +
        "Return only a JSON object with a 'code' field. Codes are " +
        "typically 4-8 characters: digits, letters, or both, sometimes " +
        "hyphenated (e.g. 'A4F-92K'). If multiple codes appear, return " +
        "the one most clearly labeled as verification/confirmation/" +
        "security/one-time. Do NOT return order numbers, tracking " +
        "numbers, prices, or dates. If no code is present, return null.",
    },
    {
      role: "user",
      content: `Subject: ${subject ?? ""}\nFrom: ${fromAddress}\n\n${textContent ?? htmlContent ?? ""}`,
    },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "extracted_code",
      schema: {
        type: "object",
        properties: {
          code: { type: ["string", "null"] },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
  },
});
```

The model output is guaranteed to be valid JSON matching the schema. Pass through `textContent` if present, otherwise raw `htmlContent` — no pre-processing in v1. The model handles markup well enough; we can revisit cleanup if extraction quality is poor.

## UI

### Popup: message detail view

In `apps/extension/entrypoints/popup/routes/message.tsx`, when the fetched message has `extractedCode !== null`, render a code panel above the existing iframe:

```
┌─────────────────────────────────────────┐
│  ← Back                                 │
│                                         │
│  Confirmation code                      │
│  ┌───────────────────────────────────┐  │
│  │  482931                  [📋]     │  │
│  └───────────────────────────────────┘  │
│                                         │
│  From: noreply@stripe.com               │
│  Subject: Verify your email             │
│  ─────────────────────────              │
│  [iframe — sanitized email body]        │
└─────────────────────────────────────────┘
```

- Large monospaced display (`text-2xl font-mono tracking-wider`).
- Copy button with checkmark feedback (mirror the pattern used by the account-list copy button).
- Visually distinct, sits above the existing iframe wrapper.

### Popup: message list

In `apps/extension/entrypoints/popup/routes/messages.tsx`, messages with an extracted code show a small badge `code: 482931` in monospace, right-aligned in the row. Clicking the badge area copies the code without drilling into the message.

### Popup: auto-copy on open

In the popup root (e.g., `apps/extension/entrypoints/popup/main.tsx` or a small effect in the accounts route), on initial mount:

1. Query the most recent message across all the user's accounts with `extractedCode !== null` and `receivedAt > now - 5 min` and `isRead = false`.
2. If found, `await navigator.clipboard.writeText(extractedCode)`.
3. Show a small unobtrusive toast: `Code 482931 copied`. Auto-dismiss after 2s.

Fail silently if the clipboard write throws (permissions, focus, etc.).

5-minute freshness window prevents auto-copying stale codes from earlier in the day. Unread filter prevents re-copying after the user has already used a code (we mark read on view).

### Content script: code input detection

In a new file `apps/extension/entrypoints/content/otp-icon.ts`, mirror `icon.ts` but for code inputs:

```ts
const NAME_REGEX = /(otp|2fa|verification|confirmation|code)/i;

function isCodeInput(el: HTMLInputElement): boolean {
  if (el.autocomplete === "one-time-code") return true;
  if (el.inputMode === "numeric" && NAME_REGEX.test(el.name + el.placeholder + el.ariaLabel))
    return true;
  if (el.maxLength >= 4 && el.maxLength <= 8 && NAME_REGEX.test(el.name + el.placeholder))
    return true;
  return false;
}
```

Same shadow-DOM "B" icon, same focus-to-show behavior, same `fillInput()` helper. The panel that pops on click shows the most recent extracted code (across all accounts) with a "Fill" button.

Both `icon.ts` and `otp-icon.ts` should be initialized from `apps/extension/entrypoints/content.ts`.

### Background script: new message type

Add `GET_LATEST_CODE` to `apps/extension/entrypoints/background.ts`. Calls `GET /api/codes/latest` (a new endpoint) which returns the most recent extracted code across the user's accounts. Used by the content script's code panel.

## API additions

```
GET /api/codes/latest
→ 200 { code: string, fromAddress: string, receivedAt: number } | 404
```

Lives under its own `/api/codes` group rather than nested under `/api/email-accounts/...` because it's intentionally cross-account.

Returns the most recent message across all the authenticated user's non-expired accounts where `extractedCode IS NOT NULL` and `receivedAt > now - 10 min` (slightly wider window than the popup's auto-copy, since the user might be on a slow flow).

## Architecture decisions

A few design choices have non-obvious reasoning worth recording.

**Workers AI over regex.** Regex covers ~85-90% of confirmation emails; the long tail (multilingual, weird formatting, new services) breaks it and requires ongoing pattern maintenance. Workers AI handles the tail at fractions of a cent per message, runs entirely inside Cloudflare's network (no third-party hop), and doesn't need maintenance as email templates evolve. Direct binding — no AI Gateway in v1, can add later for caching/observability if extraction quality needs tuning.

**Model: GLM-4.7-Flash (`@cf/zai-org/glm-4.7-flash`).** Zhipu AI's lightweight model, ~131K context window, optimized for instruction-following and multilingual input. Code extraction is a small task, so we deliberately pick a small/fast model — Kimi K2.6 is also on Workers AI but at 1T parameters is dramatically overkill (and more expensive) for "find 6 digits in a 500-token email." If extraction quality is unsatisfactory in practice, the model ID is the only swap needed to try Llama 3.x, Qwen3, or Kimi.

**Queue instead of synchronous extraction.** A sync extraction inside `syncAndList` would add ~200-500ms × N messages to popup load. Queue decouples: popup returns instantly, codes fill in asynchronously. Also gives us batching, automatic retries, and a DLQ for failures. Some learning value too — Queues is one of the more idiomatic Cloudflare primitives.

**Cron over Mercure/SSE + Durable Objects.** mail.tm exposes a Mercure (SSE-based) push endpoint, which would give sub-second latency. Consuming it would require a Durable Object per account holding a long-lived outbound HTTP connection. DOs are billed for awake time, and holding an outbound subscription keeps them awake continuously — back-of-envelope ~$4/account/month. Cron polling every minute is dramatically cheaper (~$3/month total) at a cost of up to 60s latency. The Mercure path is the textbook Cloudflare answer for _inbound_ connections (chat rooms, multiplayer state); outbound long-lived subscriptions are the wrong shape for DOs.

**Cron-only, not also extension-background polling.** The trigger responsibility belongs on the worker, not the client. Cron handles freshness regardless of whether Chrome is open. Popup-open also triggers sync as it does today, giving an immediate "refresh now" path for the case where the user opens the popup between cron ticks.

**One extracted code per message, stored as a column.** Multi-code support is YAGNI for v1 — confirmation emails essentially always contain one code. A column is simpler than a join table and easy to evolve into one later if the assumption breaks.

## Phasing

A reasonable implementation order, each step independently testable:

1. **Schema migration.** Add the two columns. No behavior change.
2. **Queue plumbing.** Wire up the queue producer and consumer with a no-op handler that just sets `extractionStatus = 'done'`. Verify end-to-end queue flow.
3. **AI extraction.** Replace the no-op with the real `env.AI.run` call. Test with a handful of real emails.
4. **Cron trigger.** Add the cron handler. Verify sync runs every minute.
5. **Popup UI: code panel + badges.** Server-side fields already populated.
6. **Popup UI: auto-copy.** Behind a small `latestCode` query.
7. **Content script: OTP input detection + B icon.** Mirror the email pattern.
8. **Latest-code endpoint** for content-script consumption.

Each step is a small, isolated commit. Steps 1-4 are server-only; 5-8 are extension-only.

## Open questions

None at spec time. Implementation should resolve at the code level:

- Exact `wrangler.toml` queue naming convention (match any existing convention in the repo).
- Whether to use Effect-wrapped queue producer or a raw `env.QUEUE.send(...)` — match the codebase's existing style.
