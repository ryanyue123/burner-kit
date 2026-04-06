# Temp Email Generation & Autofill Popup — Design Spec

## Overview

Add the first product functionality to Burner Kit: generating temporary email addresses via mail.tm, viewing received messages in the extension popup, and offering a non-intrusive autofill experience on web pages that coexists with password managers like 1Password.

## Architecture

**Extension → Worker → mail.tm** (Worker proxies everything)

```
┌─────────────────────────────────┐
│  Chrome Extension (WXT + React) │
│                                 │
│  ┌─────────┐  ┌──────────────┐  │
│  │ Popup   │  │Content Script│  │
│  │(accordion│  │(icon + panel │  │
│  │ inbox)  │  │ near inputs) │  │
│  └────┬────┘  └──────┬───────┘  │
│       └──────┬───────┘          │
│         Background SW           │
│      (auth + API client)        │
└──────────┬──────────────────────┘
           │ fetch (authenticated)
┌──────────▼──────────────────────┐
│  Cloudflare Worker (Hono)       │
│                                 │
│  /api/email-accounts  (CRUD)    │
│  /api/email-messages  (inbox)   │
│  /api/auth/*          (existing)│
│                                 │
│  Effect services + layers       │
│  mail.tm client (server-side)   │
│  D1: email_accounts, email_messages │
└─────────────────────────────────┘
```

- The extension only talks to the Worker (never to mail.tm directly)
- mail.tm tokens are stored in D1 and never sent to the extension
- The background service worker owns the session and relays messages to the popup and content script

## Tech Stack

| Layer                 | Technology                                                           |
| --------------------- | -------------------------------------------------------------------- |
| Extension UI          | React + shadcn/ui (Base UI style, `@base-ui/react`) + Tailwind CSS   |
| Extension framework   | WXT (MV3)                                                            |
| Color scheme          | Neutral dark + blue primary (#3b82f6), shadcn dark theme (base-nova) |
| API client            | `@effect/rpc-http` + TanStack Query via `effect-query`               |
| Worker framework      | Hono                                                                 |
| Worker business logic | Effect (services, layers, typed error channel)                       |
| Schema/validation     | Effect Schema + `@hono/effect-validator`                             |
| HTTP client (server)  | Effect HttpClient (`@effect/platform`)                               |
| Database              | Cloudflare D1 + Drizzle ORM                                          |
| Auth                  | Better Auth (anonymous plugin, existing)                             |
| Temp email provider   | mail.tm (free REST API, proxied through Worker)                      |

### Effect on the Worker

Effect is adopted fully on the Worker side:

- **Effect Schema** replaces Zod for all validation (request bodies, API responses, mail.tm data)
- **Effect Services + Layers** for dependency injection: MailTmClient, EmailAccountService, D1 database access
- **Effect error channel** (`Effect<A, E, R>`) for typed, recoverable errors throughout business logic
- **Effect HttpClient** (`@effect/platform`) for mail.tm API calls
- **Drizzle** remains the ORM, wrapped in Effect services
- **Hono handlers** call `Effect.runPromise()` to bridge into Effect and return typed JSON responses

Effect does NOT run on the extension side. The extension consumes plain JSON via Hono RPC and React Query.

### Effect RPC + TanStack Query for End-to-End Types

The Worker defines request schemas as tagged classes via `Schema.TaggedRequest`, specifying payload, success type, and failure type. An `RpcRouter` handles these on the server side, mounted in Hono via `@effect/rpc-http`.

On the extension side, `@effect/rpc-http` provides a typed client (HttpResolver). `effect-query` bridges this with TanStack Query, providing `queryOptions()` and `mutationOptions()` that run Effects through React Query. This gives end-to-end type safety including the error channel — something Hono RPC alone cannot provide.

### shadcn/ui with Base UI

The extension uses shadcn/ui's Base UI style variant (`base-nova`), which is built on `@base-ui/react` instead of Radix primitives. Components are installed via `npx shadcn@latest add <component>` with the base style selected. This provides the same shadcn component API and Tailwind CSS styling but with Base UI's lighter, more composable primitives underneath.

## Data Model

Two new tables in D1 alongside existing Better Auth tables.

### `email_accounts`

| Column              | Type              | Notes                                         |
| ------------------- | ----------------- | --------------------------------------------- |
| `id`                | text (cuid2)      | PK                                            |
| `userId`            | text              | FK → user.id                                  |
| `email`             | text, unique      | Full address (e.g. `xk7f9@randmail.org`)      |
| `providerAccountId` | text              | mail.tm account ID                            |
| `providerToken`     | text              | mail.tm bearer token (server-side only)       |
| `domain`            | text              | Domain portion                                |
| `label`             | text, nullable    | Optional user-set label                       |
| `createdAt`         | integer           | Timestamp                                     |
| `expiresAt`         | integer, nullable | Null = manual control, otherwise auto-cleanup |

### `email_messages`

| Column           | Type           | Notes                  |
| ---------------- | -------------- | ---------------------- |
| `id`             | text           | mail.tm message ID     |
| `emailAccountId` | text           | FK → email_accounts.id |
| `fromAddress`    | text           | Sender address         |
| `subject`        | text, nullable |                        |
| `textContent`    | text, nullable | Plain text body        |
| `htmlContent`    | text, nullable | HTML body              |
| `receivedAt`     | integer        | Timestamp              |
| `isRead`         | integer        | 0/1 boolean            |

## Worker API Endpoints

All new routes behind `requireUser` middleware. Responses use discriminated unions (`{ ok: true, data } | { ok: false, error }`).

| Method   | Path                                      | Description                                                                              |
| -------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST`   | `/api/email-accounts`                     | Generate a new burner email (calls mail.tm, stores in D1, returns account without token) |
| `GET`    | `/api/email-accounts`                     | List user's email accounts (with unread count per account)                               |
| `DELETE` | `/api/email-accounts/:id`                 | Delete an email account and its messages                                                 |
| `PATCH`  | `/api/email-accounts/:id`                 | Update label or expiresAt                                                                |
| `GET`    | `/api/email-accounts/:id/messages`        | Fetch messages (polls mail.tm for new, caches in D1, returns list)                       |
| `GET`    | `/api/email-accounts/:id/messages/:msgId` | Get full message content                                                                 |
| `PATCH`  | `/api/email-accounts/:id/messages/:msgId` | Mark as read/unread                                                                      |

### `GET /api/email-accounts/:id/messages` behavior

This endpoint syncs with mail.tm before returning:

1. Fetch new messages from mail.tm using the stored provider token
2. Insert any new messages into D1
3. Return the full message list from D1

This builds up a local cache so historical messages remain available even if mail.tm deletes them.

## Content Script (Inline Icon + Panel)

### Email field detection

The content script scans for email input fields:

- `input[type="email"]`
- `input[autocomplete="email"]`
- `input[name]` / `input[placeholder]` containing "email" (case-insensitive)

A MutationObserver watches for dynamically added inputs (SPA support), with debounced scanning.

### Icon behavior

- 16px icon rendered in a Shadow DOM container, positioned near the input's right edge
- Shadow DOM isolates styles from the host page and vice versa
- Icon appears on focus or hover of a matching input, fades out on blur after a delay
- Clicking the icon opens the mini panel

### Panel behavior

- ~320px wide panel, anchored below the input field
- "Generate new" button at top + list of recently created burner emails
- Clicking a burner email fills the input value and dispatches `input` + `change` events (so frameworks like React detect the change)
- Panel closes after fill, on outside click, or on Escape

### Coexistence with password managers

- Shadow DOM for complete style isolation
- Only targets email-looking fields, not password or username fields
- Does not modify `autocomplete` attributes on any field
- Icon positioned to avoid overlapping where 1Password typically places its icon

## Extension Popup (Accordion Inbox)

### Layout

320px wide, max-height ~500px with scrollable container.

1. **Header** — "Burner Kit" branding + "+ New" button
2. **Account list** — expandable accordion, one item per email account:
   - **Collapsed:** email address, unread badge count, copy button
   - **Expanded:** list of received messages showing sender, subject, timestamp, read/unread state. Click a message to view its content inline.
3. **Empty state** — prompt to generate the first burner email
4. **Account actions** — delete, edit label, copy address

### Message viewing

- Clicking a message expands it inline within the accordion to show text content
- HTML emails rendered in a sandboxed iframe to prevent XSS from email content
- Messages marked as read automatically on expand

### Polling

- Popup fetches accounts + message counts on open
- No background polling — fetches only when the popup is open or user explicitly refreshes
- Extension badge (`chrome.action.setBadgeText`) updated when a new burner is generated

## Background Service Worker

Extends the existing background SW (which already handles auth).

### Message types

| Type                 | Source                  | Description                                             |
| -------------------- | ----------------------- | ------------------------------------------------------- |
| `GENERATE_EMAIL`     | Content script or popup | Request new burner → call Worker → return email address |
| `GET_EMAIL_ACCOUNTS` | Popup                   | Request account list                                    |
| `GET_MESSAGES`       | Popup                   | Request messages for an account                         |
| `FILL_EMAIL`         | Content script          | Request a specific burner email to fill into an input   |
| `MARK_READ`          | Popup                   | Mark a message as read                                  |

### Design principles

- Owns the Hono RPC client instance (single source of API calls)
- Relays messages between content script and popup via `chrome.runtime.onMessage`
- Updates extension badge count after generation
- No background polling — only makes API calls in response to user actions (idle-friendly for MV3 SW lifecycle)

## Error Handling

### Worker (Effect)

All business logic returns `Effect<A, E, R>` with typed errors. Error types are defined per domain:

- `MailTmError` — mail.tm API failures (down, rate limited, invalid response)
- `EmailAccountNotFoundError` — requested account doesn't exist or doesn't belong to user
- `EmailMessageNotFoundError` — requested message doesn't exist

Hono handlers run Effect programs via `Effect.runPromise()` and map results to discriminated union JSON responses:

- Success: `{ ok: true, data: T }`
- Failure: `{ ok: false, error: { code: string, message: string } }`

Unexpected errors caught by Hono's `app.onError()` return a generic 500 response.

### Extension

- If Worker returns an error response, the popup/content script shows the error message (e.g. "Couldn't generate email — try again")
- If Worker returns 401, the background SW re-triggers anonymous sign-in and retries the request once
- No automatic retry logic in v1 — user retries manually

## Color Scheme

Neutral dark + blue, mapped to shadcn CSS variables:

| Token                  | Value     | Usage                                 |
| ---------------------- | --------- | ------------------------------------- |
| `--background`         | `#111113` | Page/popup background                 |
| `--foreground`         | `#ededef` | Primary text                          |
| `--primary`            | `#3b82f6` | Buttons, active borders, brand accent |
| `--primary-foreground` | `#ffffff` | Text on primary                       |
| `--muted`              | `#232329` | Borders, subtle backgrounds           |
| `--muted-foreground`   | `#6b6b76` | Secondary text                        |
| `--destructive`        | `#ef4444` | Delete actions, unread badges         |
