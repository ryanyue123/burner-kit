# Temp Email Generation & Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add temporary email generation (via mail.tm), an accordion inbox popup, and a non-intrusive content script autofill icon/panel to the Burner Kit extension.

**Architecture:** Extension → Worker → mail.tm. The Worker proxies all mail.tm calls via Effect services. The extension uses Effect RPC + effect-query + TanStack Query for typed data fetching. Content script uses Shadow DOM for style isolation and coexistence with password managers.

**Tech Stack:** Effect + Effect Schema + @effect/rpc-http + @effect/platform (Worker), React + shadcn/ui Base UI + Tailwind CSS + TanStack Query + effect-query (Extension), Drizzle ORM + D1 (database), WXT (extension framework)

---

## File Structure

### Worker — new/modified files

| File | Responsibility |
|------|---------------|
| `apps/worker/src/index.ts` | **Modify** �� add CORS methods (DELETE, PATCH), mount email routes + RPC router |
| `apps/worker/src/middleware.ts` | **Modify** ��� add Effect runtime factory |
| `apps/worker/src/db/schema.ts` | **Modify** — add emailAccount + emailMessage tables |
| `apps/worker/src/errors.ts` | **Create** ��� Effect tagged error classes |
| `apps/worker/src/schemas.ts` | **Create** — Effect Schema definitions for API request/response shapes |
| `apps/worker/src/services/mail-tm.ts` | **Create** — Effect service wrapping the mail.tm REST API |
| `apps/worker/src/services/email-account.ts` | **Create** — Effect service for email account CRUD |
| `apps/worker/src/services/email-message.ts` | **Create** — Effect service for message sync + retrieval |
| `apps/worker/src/routes/email-accounts.ts` | **Create** — Hono route handlers for /api/email-accounts |
| `apps/worker/src/rpc/requests.ts` | **Create** (follow-up) — Effect RPC tagged request definitions (not in this plan; Hono routes used first) |
| `apps/worker/src/rpc/router.ts` | **Create** (follow-up) — Effect RPC router (not in this plan; can be layered on without UI changes) |
| `apps/worker/package.json` | **Modify** — add effect, @effect/platform, @effect/rpc, @effect/rpc-http, @hono/effect-validator, @paralleldrive/cuid2 |

### Extension — new/modified files

| File | Responsibility |
|------|---------------|
| `apps/extension/package.json` | **Modify** — upgrade react/react-dom to 19, add tailwindcss, @tailwindcss/vite, shadcn deps, @tanstack/react-query, effect-query, @effect/rpc-http, effect |
| `apps/extension/app.css` | **Create** — Tailwind directives + shadcn CSS variables (dark theme, blue primary) |
| `apps/extension/components.json` | **Create** — shadcn config (base style, base-nova) |
| `apps/extension/lib/utils.ts` | **Create** — cn() utility for shadcn |
| `apps/extension/components/ui/*.tsx` | **Create** — shadcn Base UI components (button, accordion, badge, scroll-area, input, tooltip) |
| `apps/extension/lib/api-client.ts` | **Create** — Effect RPC client + effect-query setup |
| `apps/extension/entrypoints/popup/main.tsx` | **Modify** — add QueryClientProvider, import CSS |
| `apps/extension/entrypoints/popup/App.tsx` | **Modify** — rewrite to accordion inbox UI |
| `apps/extension/entrypoints/popup/components/header.tsx` | **Create** — popup header with branding + generate button |
| `apps/extension/entrypoints/popup/components/account-list.tsx` | **Create** — accordion list of email accounts |
| `apps/extension/entrypoints/popup/components/message-list.tsx` | **Create** — message list within expanded accordion item |
| `apps/extension/entrypoints/popup/components/message-view.tsx` | **Create** — inline message content viewer |
| `apps/extension/entrypoints/popup/components/empty-state.tsx` | **Create** — empty state prompt |
| `apps/extension/entrypoints/background.ts` | **Modify** — add new message types (GENERATE_EMAIL, GET_EMAIL_ACCOUNTS, etc.) |
| `apps/extension/entrypoints/content.ts` | **Create** — content script entry (email field detection + MutationObserver) |
| `apps/extension/entrypoints/content/icon.ts` | **Create** — Shadow DOM icon rendering + positioning |
| `apps/extension/entrypoints/content/panel.tsx` | **Create** — Shadow DOM panel with generate + recent burners |
| `apps/extension/wxt.config.ts` | **Modify** — add content script config, add host permissions |

---

## Task 1: Upgrade React to 19 + Add Tailwind CSS

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/wxt.config.ts`
- Create: `apps/extension/app.css`
- Modify: `apps/extension/entrypoints/popup/index.html`
- Modify: `apps/extension/entrypoints/popup/main.tsx`

- [ ] **Step 1: Upgrade React and type packages**

```bash
cd apps/extension
pnpm add react@latest react-dom@latest
pnpm add -D @types/react@latest @types/react-dom@latest
```

- [ ] **Step 2: Install Tailwind CSS and its Vite plugin**

```bash
cd apps/extension
pnpm add -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Configure Tailwind Vite plugin in WXT**

In `apps/extension/wxt.config.ts`, add the Tailwind Vite plugin:

```typescript
import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  runner: {
    binaries: {
      chrome: "/Applications/Helium.app/Contents/MacOS/Helium",
    },
  },
  manifest: {
    name: "burner-kit",
    description: "Disposable credential vault",
    permissions: ["storage"],
    host_permissions: ["http://localhost:8787/*"],
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoN/yEYF51QgnbuoOn3D/69dIULcLdY9hgWKh4fH8qtKG8ehU+FhGugIfLi5th92PtCErGyMCRExSn2q8Pt6+pp+CMpbcZY2PtaRHjPWddutXc1gBiHmM28udtyZfWOojbwGKSYMyHBl4E84uZn/7ejYL2VUCIyl4i+jkIsl6L0bKmgUVA1glW71szJCf2/Rr0Jd2KoLUJfrSPWBBi3b10ublj6eZoOmtRZttm1lDV07I4Pgiev4e9DqGcLvMUy2OniFnbbvd71MalNyPfC1i68w8tKR+7vAaWDdusW4bnenb9dPzTenRQ/PnYW9QTO4nA0xjmfyDytgL/J3TJc4HeQIDAQAB",
  },
});
```

- [ ] **Step 4: Create the CSS file with Tailwind directives and shadcn dark theme variables**

Create `apps/extension/app.css`:

```css
@import "tailwindcss";

@layer base {
  :root {
    --background: 0 0% 7%;
    --foreground: 240 2% 93%;
    --card: 0 0% 7%;
    --card-foreground: 240 2% 93%;
    --popover: 0 0% 7%;
    --popover-foreground: 240 2% 93%;
    --primary: 217 91% 60%;
    --primary-foreground: 0 0% 100%;
    --secondary: 240 3% 14%;
    --secondary-foreground: 240 2% 93%;
    --muted: 240 3% 14%;
    --muted-foreground: 240 3% 46%;
    --accent: 240 3% 14%;
    --accent-foreground: 240 2% 93%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 240 3% 14%;
    --input: 240 3% 14%;
    --ring: 217 91% 60%;
    --radius: 0.5rem;
  }

  * {
    border-color: hsl(var(--border));
  }

  body {
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  button:not(:disabled),
  [role="button"]:not(:disabled) {
    cursor: pointer;
  }
}
```

- [ ] **Step 5: Import CSS in popup entry**

Update `apps/extension/entrypoints/popup/main.tsx`:

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "../../app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Verify the extension builds and loads**

```bash
cd /Users/ryanyue/burner-kit
pnpm --filter extension build
```

Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/
git commit -m "feat(extension): upgrade React 19 + add Tailwind CSS with dark theme"
```

---

## Task 2: Initialize shadcn/ui with Base UI Style

**Files:**
- Create: `apps/extension/components.json`
- Create: `apps/extension/lib/utils.ts`
- Install shadcn Base UI components

- [ ] **Step 1: Install shadcn dependencies**

```bash
cd apps/extension
pnpm add clsx tailwind-merge
```

- [ ] **Step 2: Create the cn() utility**

Create `apps/extension/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Create shadcn components.json**

Create `apps/extension/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base",
  "rsc": false,
  "tsx": true,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "tailwind": {
    "css": "app.css",
    "baseColor": "neutral"
  }
}
```

- [ ] **Step 4: Configure path aliases in WXT**

Update `apps/extension/wxt.config.ts` — add resolve aliases in the vite config:

```typescript
import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  }),
  runner: {
    binaries: {
      chrome: "/Applications/Helium.app/Contents/MacOS/Helium",
    },
  },
  manifest: {
    name: "burner-kit",
    description: "Disposable credential vault",
    permissions: ["storage"],
    host_permissions: ["http://localhost:8787/*"],
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoN/yEYF51QgnbuoOn3D/69dIULcLdY9hgWKh4fH8qtKG8ehU+FhGugIfLi5th92PtCErGyMCRExSn2q8Pt6+pp+CMpbcZY2PtaRHjPWddutXc1gBiHmM28udtyZfWOojbwGKSYMyHBl4E84uZn/7ejYL2VUCIyl4i+jkIsl6L0bKmgUVA1glW71szJCf2/Rr0Jd2KoLUJfrSPWBBi3b10ublj6eZoOmtRZttm1lDV07I4Pgiev4e9DqGcLvMUy2OniFnbbvd71MalNyPfC1i68w8tKR+7vAaWDdusW4bnenb9dPzTenRQ/PnYW9QTO4nA0xjmfyDytgL/J3TJc4HeQIDAQAB",
  },
});
```

- [ ] **Step 5: Add shadcn Base UI components**

Run from the `apps/extension` directory. If `npx shadcn@latest add` prompts for style, select **base**:

```bash
cd apps/extension
npx shadcn@latest add button accordion badge scroll-area input tooltip
```

If the CLI doesn't support the `base` style interactively, manually install `@base-ui/react` and copy components from the shadcn docs (base-nova variants). The key dependency:

```bash
pnpm add @base-ui/react
```

- [ ] **Step 6: Verify a component imports correctly**

Temporarily update `apps/extension/entrypoints/popup/App.tsx` to test:

```typescript
import { Button } from "@/components/ui/button";

export default function App() {
  return (
    <main className="p-4 min-w-[320px]">
      <Button>Test Button</Button>
    </main>
  );
}
```

Build and confirm it compiles:

```bash
cd /Users/ryanyue/burner-kit
pnpm --filter extension build
```

Expected: Build succeeds, button renders with blue primary styling.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/
git commit -m "feat(extension): init shadcn/ui with Base UI style + dark theme"
```

---

## Task 3: Install Effect Ecosystem on Worker

**Files:**
- Modify: `apps/worker/package.json`
- Create: `apps/worker/src/errors.ts`
- Create: `apps/worker/src/runtime.ts`

- [ ] **Step 1: Install Effect packages**

```bash
cd apps/worker
pnpm add effect @effect/platform @effect/rpc @effect/rpc-http @hono/effect-validator @paralleldrive/cuid2
```

- [ ] **Step 2: Create tagged error classes**

Create `apps/worker/src/errors.ts`:

```typescript
import { Data } from "effect";

export class MailTmError extends Data.TaggedError("MailTmError")<{
  readonly reason: string;
}> {}

export class EmailAccountNotFoundError extends Data.TaggedError("EmailAccountNotFoundError")<{
  readonly accountId: string;
}> {}

export class EmailMessageNotFoundError extends Data.TaggedError("EmailMessageNotFoundError")<{
  readonly messageId: string;
}> {}
```

- [ ] **Step 3: Create Effect runtime factory for Hono handlers**

Create `apps/worker/src/runtime.ts`:

```typescript
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpClient } from "@effect/platform";

export const makeAppLayer = () =>
  Layer.mergeAll(HttpClient.layer);

export const makeRuntime = () => ManagedRuntime.make(makeAppLayer());
```

This is a minimal starting point — layers for mail.tm and DB services will be added in later tasks.

- [ ] **Step 4: Verify typecheck passes**

```bash
cd /Users/ryanyue/burner-kit
pnpm --filter worker typecheck
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/
git commit -m "feat(worker): install Effect ecosystem + define error types"
```

---

## Task 4: Add email_accounts + email_messages Database Tables

**Files:**
- Modify: `apps/worker/src/db/schema.ts`

- [ ] **Step 1: Add emailAccount table to the schema**

Append to `apps/worker/src/db/schema.ts` (after the existing `verification` table and before relations):

```typescript
export const emailAccount = sqliteTable(
  "email_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    providerAccountId: text("provider_account_id").notNull(),
    providerToken: text("provider_token").notNull(),
    domain: text("domain").notNull(),
    label: text("label"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("email_account_userId_idx").on(table.userId),
  ],
);

export const emailMessage = sqliteTable(
  "email_message",
  {
    id: text("id").primaryKey(),
    emailAccountId: text("email_account_id")
      .notNull()
      .references(() => emailAccount.id, { onDelete: "cascade" }),
    fromAddress: text("from_address").notNull(),
    subject: text("subject"),
    textContent: text("text_content"),
    htmlContent: text("html_content"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    isRead: integer("is_read", { mode: "boolean" }).default(false).notNull(),
  },
  (table) => [
    index("email_message_accountId_idx").on(table.emailAccountId),
  ],
);
```

- [ ] **Step 2: Add relations for the new tables**

Append to the relations section in `apps/worker/src/db/schema.ts`:

```typescript
export const emailAccountRelations = relations(emailAccount, ({ one, many }) => ({
  user: one(user, {
    fields: [emailAccount.userId],
    references: [user.id],
  }),
  messages: many(emailMessage),
}));

export const emailMessageRelations = relations(emailMessage, ({ one }) => ({
  emailAccount: one(emailAccount, {
    fields: [emailMessage.emailAccountId],
    references: [emailAccount.id],
  }),
}));
```

Also update the existing `userRelations` to include email accounts:

```typescript
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  emailAccounts: many(emailAccount),
}));
```

- [ ] **Step 3: Generate the migration**

```bash
cd apps/worker
pnpm db:generate
```

Expected: A new migration file is created in `apps/worker/drizzle/` (e.g., `0001_*.sql`) with CREATE TABLE statements for `email_account` and `email_message`.

- [ ] **Step 4: Apply the migration locally**

```bash
cd apps/worker
pnpm db:migrate:local
```

Expected: Migration applied successfully.

- [ ] **Step 5: Verify typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/
git commit -m "feat(worker): add email_account + email_message tables"
```

---

## Task 5: mail.tm Effect Service

**Files:**
- Create: `apps/worker/src/services/mail-tm.ts`
- Create: `apps/worker/src/schemas.ts`

- [ ] **Step 1: Create shared Effect Schema definitions**

Create `apps/worker/src/schemas.ts`:

```typescript
import { Schema as S } from "effect";

export class MailTmDomain extends S.Class<MailTmDomain>("MailTmDomain")({
  id: S.String,
  domain: S.String,
  isActive: S.Boolean,
}) {}

export class MailTmAccount extends S.Class<MailTmAccount>("MailTmAccount")({
  id: S.String,
  address: S.String,
}) {}

export class MailTmToken extends S.Class<MailTmToken>("MailTmToken")({
  token: S.String,
}) {}

export class MailTmMessage extends S.Class<MailTmMessage>("MailTmMessage")({
  id: S.String,
  from: S.Struct({
    address: S.String,
    name: S.optional(S.String),
  }),
  subject: S.optional(S.String),
  text: S.optional(S.String),
  html: S.optional(S.NullishOr(S.Array(S.String))),
  createdAt: S.String,
  seen: S.Boolean,
}) {}

export class MailTmMessageList extends S.Class<MailTmMessageList>("MailTmMessageList")({
  "hydra:member": S.Array(MailTmMessage),
}) {}

export class EmailAccountResponse extends S.Class<EmailAccountResponse>("EmailAccountResponse")({
  id: S.String,
  email: S.String,
  domain: S.String,
  label: S.NullOr(S.String),
  createdAt: S.Number,
  expiresAt: S.NullOr(S.Number),
  unreadCount: S.optional(S.Number),
}) {}

export class EmailMessageResponse extends S.Class<EmailMessageResponse>("EmailMessageResponse")({
  id: S.String,
  emailAccountId: S.String,
  fromAddress: S.String,
  subject: S.NullOr(S.String),
  textContent: S.NullOr(S.String),
  htmlContent: S.NullOr(S.String),
  receivedAt: S.Number,
  isRead: S.Boolean,
}) {}
```

- [ ] **Step 2: Create the MailTm service**

Create `apps/worker/src/services/mail-tm.ts`:

```typescript
import { Context, Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { MailTmError } from "../errors";
import { MailTmAccount, MailTmDomain, MailTmMessageList, MailTmToken } from "../schemas";

const MAIL_TM_API = "https://api.mail.tm";

export class MailTm extends Context.Tag("MailTm")<
  MailTm,
  {
    readonly getDomains: () => Effect.Effect<ReadonlyArray<typeof MailTmDomain.Type>, MailTmError>;
    readonly createAccount: (
      address: string,
      password: string,
    ) => Effect.Effect<typeof MailTmAccount.Type, MailTmError>;
    readonly getToken: (
      address: string,
      password: string,
    ) => Effect.Effect<string, MailTmError>;
    readonly getMessages: (
      token: string,
    ) => Effect.Effect<typeof MailTmMessageList.Type, MailTmError>;
  }
>() {}

export const MailTmLive = Layer.effect(
  MailTm,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const request = (method: string, path: string, body?: unknown, token?: string) =>
      Effect.gen(function* () {
        let req = HttpClientRequest.make(method)(
          `${MAIL_TM_API}${path}`,
        ).pipe(
          HttpClientRequest.setHeader("Content-Type", "application/json"),
        );
        if (token) {
          req = HttpClientRequest.setHeader("Authorization", `Bearer ${token}`)(req);
        }
        if (body) {
          req = HttpClientRequest.setBody(
            req,
            HttpClientRequest.jsonBody(body),
          );
        }
        const response = yield* client.execute(req).pipe(
          Effect.flatMap(HttpClientResponse.json),
          Effect.catchAll((e) =>
            Effect.fail(new MailTmError({ reason: `mail.tm request failed: ${e}` })),
          ),
        );
        return response;
      });

    return {
      getDomains: () =>
        request("GET", "/domains").pipe(
          Effect.map((res: any) => res["hydra:member"] as ReadonlyArray<typeof MailTmDomain.Type>),
        ),

      createAccount: (address: string, password: string) =>
        request("POST", "/accounts", { address, password }).pipe(
          Effect.map((res: any) => ({ id: res.id, address: res.address }) as typeof MailTmAccount.Type),
        ),

      getToken: (address: string, password: string) =>
        request("POST", "/token", { address, password }).pipe(
          Effect.map((res: any) => res.token as string),
        ),

      getMessages: (token: string) =>
        request("GET", "/messages", undefined, token).pipe(
          Effect.map((res) => res as typeof MailTmMessageList.Type),
        ),
    };
  }),
);
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/
git commit -m "feat(worker): add mail.tm Effect service + shared schemas"
```

---

## Task 6: EmailAccount + EmailMessage Effect Services

**Files:**
- Create: `apps/worker/src/services/email-account.ts`
- Create: `apps/worker/src/services/email-message.ts`

- [ ] **Step 1: Create the EmailAccount service**

Create `apps/worker/src/services/email-account.ts`:

```typescript
import { Context, Effect, Layer } from "effect";
import { createId } from "@paralleldrive/cuid2";
import { eq, and, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { MailTm } from "./mail-tm";
import { EmailAccountNotFoundError, MailTmError } from "../errors";

export class EmailAccountService extends Context.Tag("EmailAccountService")<
  EmailAccountService,
  {
    readonly create: (userId: string) => Effect.Effect<
      typeof schema.emailAccount.$inferSelect,
      MailTmError
    >;
    readonly list: (userId: string) => Effect.Effect<
      ReadonlyArray<typeof schema.emailAccount.$inferSelect & { unreadCount: number }>
    >;
    readonly get: (userId: string, accountId: string) => Effect.Effect<
      typeof schema.emailAccount.$inferSelect,
      EmailAccountNotFoundError
    >;
    readonly remove: (userId: string, accountId: string) => Effect.Effect<void, EmailAccountNotFoundError>;
    readonly update: (
      userId: string,
      accountId: string,
      data: { label?: string | null; expiresAt?: Date | null },
    ) => Effect.Effect<typeof schema.emailAccount.$inferSelect, EmailAccountNotFoundError>;
  }
>() {}

export const makeEmailAccountService = (db: DrizzleD1Database<typeof schema>) =>
  Layer.effect(
    EmailAccountService,
    Effect.gen(function* () {
      const mailTm = yield* MailTm;

      return {
        create: (userId: string) =>
          Effect.gen(function* () {
            const domains = yield* mailTm.getDomains();
            const activeDomains = domains.filter((d) => d.isActive);
            if (activeDomains.length === 0) {
              return yield* Effect.fail(new MailTmError({ reason: "No active domains available" }));
            }
            const domain = activeDomains[Math.floor(Math.random() * activeDomains.length)]!;
            const localPart = createId().slice(0, 10);
            const address = `${localPart}@${domain.domain}`;
            const password = createId();

            const account = yield* mailTm.createAccount(address, password);
            const token = yield* mailTm.getToken(address, password);

            const id = createId();
            const now = new Date();
            const row = {
              id,
              userId,
              email: account.address,
              providerAccountId: account.id,
              providerToken: token,
              domain: domain.domain,
              label: null,
              createdAt: now,
              expiresAt: null,
            };

            await db.insert(schema.emailAccount).values(row);
            return row;
          }),

        list: (userId: string) =>
          Effect.tryPromise({
            try: async () => {
              const accounts = await db
                .select({
                  id: schema.emailAccount.id,
                  userId: schema.emailAccount.userId,
                  email: schema.emailAccount.email,
                  providerAccountId: schema.emailAccount.providerAccountId,
                  providerToken: schema.emailAccount.providerToken,
                  domain: schema.emailAccount.domain,
                  label: schema.emailAccount.label,
                  createdAt: schema.emailAccount.createdAt,
                  expiresAt: schema.emailAccount.expiresAt,
                  unreadCount: sql<number>`(
                    SELECT COUNT(*) FROM email_message
                    WHERE email_account_id = ${schema.emailAccount.id}
                    AND is_read = 0
                  )`.as("unread_count"),
                })
                .from(schema.emailAccount)
                .where(eq(schema.emailAccount.userId, userId))
                .orderBy(schema.emailAccount.createdAt);
              return accounts;
            },
            catch: (e) => e as Error,
          }).pipe(Effect.orDie),

        get: (userId: string, accountId: string) =>
          Effect.tryPromise({
            try: () =>
              db.query.emailAccount.findFirst({
                where: and(
                  eq(schema.emailAccount.id, accountId),
                  eq(schema.emailAccount.userId, userId),
                ),
              }),
            catch: (e) => e as Error,
          }).pipe(
            Effect.orDie,
            Effect.flatMap((row) =>
              row
                ? Effect.succeed(row)
                : Effect.fail(new EmailAccountNotFoundError({ accountId })),
            ),
          ),

        remove: (userId: string, accountId: string) =>
          Effect.gen(function* () {
            const account = yield* EmailAccountService.pipe(
              Effect.flatMap((svc) => svc.get(userId, accountId)),
            );
            yield* Effect.tryPromise({
              try: () =>
                db.delete(schema.emailAccount).where(eq(schema.emailAccount.id, account.id)),
              catch: (e) => e as Error,
            }).pipe(Effect.orDie);
          }),

        update: (userId: string, accountId: string, data: { label?: string | null; expiresAt?: Date | null }) =>
          Effect.gen(function* () {
            yield* EmailAccountService.pipe(
              Effect.flatMap((svc) => svc.get(userId, accountId)),
            );
            const updates: Record<string, unknown> = {};
            if ("label" in data) updates.label = data.label;
            if ("expiresAt" in data) updates.expiresAt = data.expiresAt;
            yield* Effect.tryPromise({
              try: () =>
                db.update(schema.emailAccount).set(updates).where(eq(schema.emailAccount.id, accountId)),
              catch: (e) => e as Error,
            }).pipe(Effect.orDie);
            return yield* EmailAccountService.pipe(
              Effect.flatMap((svc) => svc.get(userId, accountId)),
            );
          }),
      };
    }),
  );
```

- [ ] **Step 2: Create the EmailMessage service**

Create `apps/worker/src/services/email-message.ts`:

```typescript
import { Context, Effect, Layer } from "effect";
import { eq, and } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { MailTm } from "./mail-tm";
import { EmailAccountNotFoundError, EmailMessageNotFoundError } from "../errors";
import { EmailAccountService } from "./email-account";

export class EmailMessageService extends Context.Tag("EmailMessageService")<
  EmailMessageService,
  {
    readonly syncAndList: (
      userId: string,
      accountId: string,
    ) => Effect.Effect<
      ReadonlyArray<typeof schema.emailMessage.$inferSelect>,
      EmailAccountNotFoundError
    >;
    readonly get: (
      userId: string,
      accountId: string,
      messageId: string,
    ) => Effect.Effect<
      typeof schema.emailMessage.$inferSelect,
      EmailAccountNotFoundError | EmailMessageNotFoundError
    >;
    readonly markRead: (
      userId: string,
      accountId: string,
      messageId: string,
      isRead: boolean,
    ) => Effect.Effect<
      typeof schema.emailMessage.$inferSelect,
      EmailAccountNotFoundError | EmailMessageNotFoundError
    >;
  }
>() {}

export const makeEmailMessageService = (db: DrizzleD1Database<typeof schema>) =>
  Layer.effect(
    EmailMessageService,
    Effect.gen(function* () {
      const mailTm = yield* MailTm;
      const emailAccountSvc = yield* EmailAccountService;

      return {
        syncAndList: (userId: string, accountId: string) =>
          Effect.gen(function* () {
            const account = yield* emailAccountSvc.get(userId, accountId);

            // Fetch from mail.tm
            const mailTmMessages = yield* mailTm.getMessages(account.providerToken).pipe(
              Effect.catchAll(() => Effect.succeed({ "hydra:member": [] as any[] })),
            );

            // Upsert new messages into D1
            for (const msg of mailTmMessages["hydra:member"]) {
              const existing = await db.query.emailMessage.findFirst({
                where: eq(schema.emailMessage.id, msg.id),
              });
              if (!existing) {
                await db.insert(schema.emailMessage).values({
                  id: msg.id,
                  emailAccountId: accountId,
                  fromAddress: msg.from.address,
                  subject: msg.subject ?? null,
                  textContent: msg.text ?? null,
                  htmlContent: msg.html ? msg.html.join("") : null,
                  receivedAt: new Date(msg.createdAt),
                  isRead: msg.seen,
                });
              }
            }

            // Return all from D1
            const messages = await db.query.emailMessage.findMany({
              where: eq(schema.emailMessage.emailAccountId, accountId),
              orderBy: (m, { desc }) => [desc(m.receivedAt)],
            });
            return messages;
          }),

        get: (userId: string, accountId: string, messageId: string) =>
          Effect.gen(function* () {
            yield* emailAccountSvc.get(userId, accountId);
            const message = await db.query.emailMessage.findFirst({
              where: and(
                eq(schema.emailMessage.id, messageId),
                eq(schema.emailMessage.emailAccountId, accountId),
              ),
            });
            if (!message) {
              return yield* Effect.fail(new EmailMessageNotFoundError({ messageId }));
            }
            return message;
          }),

        markRead: (userId: string, accountId: string, messageId: string, isRead: boolean) =>
          Effect.gen(function* () {
            yield* emailAccountSvc.get(userId, accountId);
            const message = yield* Effect.tryPromise({
              try: () =>
                db.query.emailMessage.findFirst({
                  where: and(
                    eq(schema.emailMessage.id, messageId),
                    eq(schema.emailMessage.emailAccountId, accountId),
                  ),
                }),
              catch: (e) => e as Error,
            }).pipe(Effect.orDie);
            if (!message) {
              return yield* Effect.fail(new EmailMessageNotFoundError({ messageId }));
            }
            await db
              .update(schema.emailMessage)
              .set({ isRead })
              .where(eq(schema.emailMessage.id, messageId));
            return { ...message, isRead };
          }),
      };
    }),
  );
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/services/
git commit -m "feat(worker): add EmailAccount + EmailMessage Effect services"
```

---

## Task 7: Hono Route Handlers for Email Accounts + Messages

**Files:**
- Create: `apps/worker/src/routes/email-accounts.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/runtime.ts`

- [ ] **Step 1: Update runtime to include all service layers**

Update `apps/worker/src/runtime.ts`:

```typescript
import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "@effect/platform";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { MailTmLive } from "./services/mail-tm";
import { makeEmailAccountService } from "./services/email-account";
import { makeEmailMessageService } from "./services/email-message";
import type { AppBindings } from "./middleware";

export function makeAppRuntime(env: AppBindings) {
  const db = drizzle(env.DB, { schema });

  const appLayer = Layer.mergeAll(
    makeEmailAccountService(db),
    makeEmailMessageService(db),
  ).pipe(
    Layer.provide(MailTmLive),
    Layer.provide(FetchHttpClient.layer),
  );

  return ManagedRuntime.make(appLayer);
}
```

- [ ] **Step 2: Create email accounts route handler**

Create `apps/worker/src/routes/email-accounts.ts`:

```typescript
import { Hono } from "hono";
import { Effect } from "effect";
import type { AppBindings, AppVariables } from "../middleware";
import { requireUser } from "../middleware";
import { EmailAccountService } from "../services/email-account";
import { EmailMessageService } from "../services/email-message";
import { makeAppRuntime } from "../runtime";
import { EmailAccountNotFoundError, EmailMessageNotFoundError, MailTmError } from "../errors";

type Env = { Bindings: AppBindings; Variables: AppVariables };

const emailAccounts = new Hono<Env>();

function runEffect<A>(env: AppBindings, effect: Effect.Effect<A, MailTmError | EmailAccountNotFoundError | EmailMessageNotFoundError, EmailAccountService | EmailMessageService>) {
  const runtime = makeAppRuntime(env);
  return Effect.runPromise(
    effect.pipe(
      Effect.catchTags({
        MailTmError: (e) => Effect.succeed({ _tag: "error" as const, code: "MAIL_TM_ERROR", message: e.reason }),
        EmailAccountNotFoundError: (e) => Effect.succeed({ _tag: "error" as const, code: "NOT_FOUND", message: `Account ${e.accountId} not found` }),
        EmailMessageNotFoundError: (e) => Effect.succeed({ _tag: "error" as const, code: "NOT_FOUND", message: `Message ${e.messageId} not found` }),
      }),
      Effect.provide(runtime),
    ),
  ).then((result) => {
    if (result && typeof result === "object" && "_tag" in result && result._tag === "error") {
      return { ok: false as const, error: result };
    }
    return { ok: true as const, data: result };
  });
}

// POST /api/email-accounts — generate a new burner email
emailAccounts.post("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const result = await runEffect(
    c.env,
    EmailAccountService.pipe(Effect.flatMap((svc) => svc.create(user.id))),
  );
  if (!result.ok) return c.json(result, 500);
  const { providerToken, providerAccountId, ...safe } = result.data as any;
  return c.json({ ok: true, data: safe }, 201);
});

// GET /api/email-accounts — list user's accounts
emailAccounts.get("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const result = await runEffect(
    c.env,
    EmailAccountService.pipe(Effect.flatMap((svc) => svc.list(user.id))),
  );
  return c.json(result);
});

// DELETE /api/email-accounts/:id
emailAccounts.delete("/:id", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const result = await runEffect(
    c.env,
    EmailAccountService.pipe(Effect.flatMap((svc) => svc.remove(user.id, id))),
  );
  if (!result.ok) return c.json(result, 404);
  return c.json({ ok: true });
});

// PATCH /api/email-accounts/:id
emailAccounts.patch("/:id", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const body = await c.req.json<{ label?: string | null; expiresAt?: number | null }>();
  const result = await runEffect(
    c.env,
    EmailAccountService.pipe(
      Effect.flatMap((svc) =>
        svc.update(user.id, id, {
          label: body.label,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        }),
      ),
    ),
  );
  if (!result.ok) return c.json(result, 404);
  const { providerToken, providerAccountId, ...safe } = result.data as any;
  return c.json({ ok: true, data: safe });
});

// GET /api/email-accounts/:id/messages — sync + list
emailAccounts.get("/:id/messages", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const result = await runEffect(
    c.env,
    EmailMessageService.pipe(Effect.flatMap((svc) => svc.syncAndList(user.id, id))),
  );
  if (!result.ok) return c.json(result, 404);
  return c.json(result);
});

// GET /api/email-accounts/:id/messages/:msgId
emailAccounts.get("/:id/messages/:msgId", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const msgId = c.req.param("msgId");
  const result = await runEffect(
    c.env,
    EmailMessageService.pipe(Effect.flatMap((svc) => svc.get(user.id, id, msgId))),
  );
  if (!result.ok) return c.json(result, 404);
  return c.json(result);
});

// PATCH /api/email-accounts/:id/messages/:msgId — mark read/unread
emailAccounts.patch("/:id/messages/:msgId", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const msgId = c.req.param("msgId");
  const body = await c.req.json<{ isRead: boolean }>();
  const result = await runEffect(
    c.env,
    EmailMessageService.pipe(
      Effect.flatMap((svc) => svc.markRead(user.id, id, msgId, body.isRead)),
    ),
  );
  if (!result.ok) return c.json(result, 404);
  return c.json(result);
});

export default emailAccounts;
```

- [ ] **Step 3: Mount routes in the main Hono app**

Update `apps/worker/src/index.ts` — add the email routes and update CORS methods:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { attachAuth, requireUser, type AppBindings, type AppVariables } from "./middleware";
import emailAccounts from "./routes/email-accounts";

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

app.use("*", (c, next) =>
  cors({
    origin: c.env.EXTENSION_ORIGIN ?? "*",
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    maxAge: 600,
  })(c, next),
);

app.use("*", attachAuth);

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = c.get("auth");
  return auth.handler(c.req.raw);
});

app.get("/", (c) => c.json({ ok: true, service: "burner-kit-worker" }));

app.get("/api/me", requireUser, (c) => {
  const user = c.get("user")!;
  return c.json({
    userId: user.id,
    createdAt: user.createdAt,
    isAnonymous: user.isAnonymous ?? false,
  });
});

app.route("/api/email-accounts", emailAccounts);

export default app;
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter worker typecheck
```

Expected: No type errors.

- [ ] **Step 5: Manual smoke test**

Start the dev server and test the endpoints:

```bash
pnpm dev
```

In another terminal, test the health check still works:

```bash
curl http://localhost:8787/
```

Expected: `{"ok":true,"service":"burner-kit-worker"}`

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/
git commit -m "feat(worker): add email account CRUD routes with Effect services"
```

---

## Task 8: Extension Client Setup (TanStack Query + API Client)

**Files:**
- Modify: `apps/extension/package.json`
- Create: `apps/extension/lib/api-client.ts`
- Modify: `apps/extension/entrypoints/popup/main.tsx`

- [ ] **Step 1: Install TanStack Query and API dependencies**

```bash
cd apps/extension
pnpm add @tanstack/react-query
```

- [ ] **Step 2: Create the API client module**

Create `apps/extension/lib/api-client.ts`. This is a simple typed fetch wrapper that the background SW owns. Popup and content scripts use `chrome.runtime.sendMessage` to route through it.

```typescript
const API_URL = import.meta.env.WXT_API_URL as string;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    const body = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: body.error ?? { code: "HTTP_ERROR", message: `HTTP ${res.status}` },
      };
    }
    return body as ApiResult<T>;
  } catch (err) {
    return { ok: false, error: { code: "NETWORK_ERROR", message: (err as Error).message } };
  }
}

export type EmailAccount = {
  id: string;
  email: string;
  domain: string;
  label: string | null;
  createdAt: number;
  expiresAt: number | null;
  unreadCount?: number;
};

export type EmailMessage = {
  id: string;
  emailAccountId: string;
  fromAddress: string;
  subject: string | null;
  textContent: string | null;
  htmlContent: string | null;
  receivedAt: number;
  isRead: boolean;
};
```

> **Note:** Effect RPC + effect-query integration can be added in a follow-up iteration once the base API flow is working. Starting with a simple typed fetch client gets us to a working product faster. The Hono RPC / Effect RPC layer can be wired up later without changing the UI.

- [ ] **Step 3: Add QueryClientProvider to popup entry**

Update `apps/extension/entrypoints/popup/main.tsx`:

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "../../app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 4: Verify build**

```bash
pnpm --filter extension build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/
git commit -m "feat(extension): add TanStack Query + typed API client"
```

---

## Task 9: Update Background Service Worker

**Files:**
- Modify: `apps/extension/entrypoints/background.ts`

- [ ] **Step 1: Rewrite background.ts with new message types**

Replace the contents of `apps/extension/entrypoints/background.ts`:

```typescript
import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";
import { apiRequest, type EmailAccount, type EmailMessage, type ApiResult } from "@/lib/api-client";

const API_URL = import.meta.env.WXT_API_URL as string;

const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [anonymousClient()],
  fetchOptions: {
    credentials: "include",
  },
});

async function ensureAnonymousSession(): Promise<void> {
  try {
    const session = await authClient.getSession();
    if (session.data?.user) return;
  } catch (err) {
    console.warn("getSession failed, attempting anonymous sign-in", err);
  }
  const result = await authClient.signIn.anonymous();
  if (result.error) {
    console.error("anonymous sign-in failed", result.error);
    throw new Error(result.error.message ?? "anonymous sign-in failed");
  }
  console.log("anonymous sign-in succeeded");
}

type MessageMap = {
  GENERATE_EMAIL: { type: "GENERATE_EMAIL" };
  GET_EMAIL_ACCOUNTS: { type: "GET_EMAIL_ACCOUNTS" };
  GET_MESSAGES: { type: "GET_MESSAGES"; accountId: string };
  GET_MESSAGE: { type: "GET_MESSAGE"; accountId: string; messageId: string };
  MARK_READ: { type: "MARK_READ"; accountId: string; messageId: string; isRead: boolean };
  DELETE_ACCOUNT: { type: "DELETE_ACCOUNT"; accountId: string };
  UPDATE_ACCOUNT: { type: "UPDATE_ACCOUNT"; accountId: string; label?: string | null; expiresAt?: number | null };
  GET_ME: { type: "GET_ME" };
};

type Message = MessageMap[keyof MessageMap];

export default defineBackground(() => {
  console.log("burner-kit background started");

  ensureAnonymousSession().catch((err) => console.error(err));

  chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    (async () => {
      await ensureAnonymousSession();

      switch (message.type) {
        case "GET_ME": {
          const res = await apiRequest<{ userId: string; createdAt: string; isAnonymous: boolean }>("/api/me");
          sendResponse(res);
          break;
        }
        case "GENERATE_EMAIL": {
          const res = await apiRequest<EmailAccount>("/api/email-accounts", { method: "POST" });
          sendResponse(res);
          break;
        }
        case "GET_EMAIL_ACCOUNTS": {
          const res = await apiRequest<EmailAccount[]>("/api/email-accounts");
          sendResponse(res);
          break;
        }
        case "GET_MESSAGES": {
          const res = await apiRequest<EmailMessage[]>(
            `/api/email-accounts/${message.accountId}/messages`,
          );
          sendResponse(res);
          break;
        }
        case "GET_MESSAGE": {
          const res = await apiRequest<EmailMessage>(
            `/api/email-accounts/${message.accountId}/messages/${message.messageId}`,
          );
          sendResponse(res);
          break;
        }
        case "MARK_READ": {
          const res = await apiRequest<EmailMessage>(
            `/api/email-accounts/${message.accountId}/messages/${message.messageId}`,
            { method: "PATCH", body: JSON.stringify({ isRead: message.isRead }) },
          );
          sendResponse(res);
          break;
        }
        case "DELETE_ACCOUNT": {
          const res = await apiRequest<void>(
            `/api/email-accounts/${message.accountId}`,
            { method: "DELETE" },
          );
          sendResponse(res);
          break;
        }
        case "UPDATE_ACCOUNT": {
          const { accountId, ...body } = message;
          const res = await apiRequest<EmailAccount>(
            `/api/email-accounts/${accountId}`,
            { method: "PATCH", body: JSON.stringify(body) },
          );
          sendResponse(res);
          break;
        }
      }
    })();
    return true; // keep channel open for async sendResponse
  });
});
```

- [ ] **Step 2: Verify build**

```bash
pnpm --filter extension build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/entrypoints/background.ts
git commit -m "feat(extension): add all message types to background SW"
```

---

## Task 10: Popup — Accordion Inbox UI

**Files:**
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Create: `apps/extension/entrypoints/popup/components/header.tsx`
- Create: `apps/extension/entrypoints/popup/components/account-list.tsx`
- Create: `apps/extension/entrypoints/popup/components/message-list.tsx`
- Create: `apps/extension/entrypoints/popup/components/message-view.tsx`
- Create: `apps/extension/entrypoints/popup/components/empty-state.tsx`
- Create: `apps/extension/entrypoints/popup/hooks/use-api.ts`

- [ ] **Step 1: Create the useApi hook for chrome.runtime messaging**

Create `apps/extension/entrypoints/popup/hooks/use-api.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmailAccount, EmailMessage, ApiResult } from "@/lib/api-client";

function sendMessage<T>(message: Record<string, unknown>): Promise<ApiResult<T>> {
  return chrome.runtime.sendMessage(message);
}

export function useEmailAccounts() {
  return useQuery({
    queryKey: ["email-accounts"],
    queryFn: () => sendMessage<EmailAccount[]>({ type: "GET_EMAIL_ACCOUNTS" }),
  });
}

export function useMessages(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["messages", accountId],
    queryFn: () => sendMessage<EmailMessage[]>({ type: "GET_MESSAGES", accountId }),
    enabled,
  });
}

export function useGenerateEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendMessage<EmailAccount>({ type: "GENERATE_EMAIL" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-accounts"] }),
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => sendMessage<void>({ type: "DELETE_ACCOUNT", accountId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-accounts"] }),
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, messageId, isRead }: { accountId: string; messageId: string; isRead: boolean }) =>
      sendMessage<EmailMessage>({ type: "MARK_READ", accountId, messageId, isRead }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["messages", variables.accountId] });
      queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
    },
  });
}
```

- [ ] **Step 2: Create the header component**

Create `apps/extension/entrypoints/popup/components/header.tsx`:

```typescript
import { Button } from "@/components/ui/button";

export function Header({ onGenerate, isGenerating }: { onGenerate: () => void; isGenerating: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-primary rounded flex items-center justify-center text-xs font-bold text-primary-foreground">
          B
        </div>
        <span className="text-sm font-semibold text-foreground">Burner Kit</span>
      </div>
      <Button size="sm" onClick={onGenerate} disabled={isGenerating}>
        {isGenerating ? "Creating..." : "+ New"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Create the empty state component**

Create `apps/extension/entrypoints/popup/components/empty-state.tsx`:

```typescript
import { Button } from "@/components/ui/button";

export function EmptyState({ onGenerate, isGenerating }: { onGenerate: () => void; isGenerating: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <p className="text-sm text-muted-foreground mb-4">
        No burner emails yet. Generate one to get started.
      </p>
      <Button onClick={onGenerate} disabled={isGenerating}>
        {isGenerating ? "Creating..." : "Generate Burner Email"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Create the message list component**

Create `apps/extension/entrypoints/popup/components/message-list.tsx`:

```typescript
import { useMessages, useMarkRead } from "../hooks/use-api";
import { MessageView } from "./message-view";
import { useState } from "react";
import type { EmailMessage } from "@/lib/api-client";

export function MessageList({ accountId }: { accountId: string }) {
  const { data, isLoading } = useMessages(accountId, true);
  const markRead = useMarkRead();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) return <div className="p-3 text-xs text-muted-foreground">Loading...</div>;
  if (!data?.ok) return <div className="p-3 text-xs text-destructive">Failed to load messages</div>;

  const messages = data.data;
  if (messages.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No messages yet</div>;
  }

  function handleExpand(msg: EmailMessage) {
    if (expandedId === msg.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(msg.id);
    if (!msg.isRead) {
      markRead.mutate({ accountId, messageId: msg.id, isRead: true });
    }
  }

  return (
    <div className="border-t border-border">
      {messages.map((msg) => (
        <div key={msg.id}>
          <button
            type="button"
            onClick={() => handleExpand(msg)}
            className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex justify-between items-center">
              <span className={`text-xs truncate ${msg.isRead ? "text-muted-foreground" : "text-foreground font-medium"}`}>
                {msg.subject ?? "(no subject)"}
              </span>
              <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
                {new Date(msg.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{msg.fromAddress}</div>
          </button>
          {expandedId === msg.id && <MessageView message={msg} />}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create the message view component**

Create `apps/extension/entrypoints/popup/components/message-view.tsx`:

```typescript
import type { EmailMessage } from "@/lib/api-client";
import { useRef, useEffect } from "react";

export function MessageView({ message }: { message: EmailMessage }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (message.htmlContent && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(message.htmlContent);
        doc.close();
      }
    }
  }, [message.htmlContent]);

  if (message.htmlContent) {
    return (
      <div className="px-3 pb-3">
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          className="w-full min-h-[200px] border border-border rounded bg-white"
          title="Email content"
        />
      </div>
    );
  }

  return (
    <div className="px-3 pb-3">
      <pre className="text-xs text-foreground whitespace-pre-wrap break-words bg-secondary/50 rounded p-2">
        {message.textContent ?? "(empty message)"}
      </pre>
    </div>
  );
}
```

- [ ] **Step 6: Create the account list component**

Create `apps/extension/entrypoints/popup/components/account-list.tsx`:

```typescript
import { useState } from "react";
import { useDeleteAccount } from "../hooks/use-api";
import { MessageList } from "./message-list";
import type { EmailAccount } from "@/lib/api-client";

export function AccountList({ accounts }: { accounts: EmailAccount[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const deleteAccount = useDeleteAccount();

  function handleCopy(email: string) {
    navigator.clipboard.writeText(email);
  }

  return (
    <div className="divide-y divide-border">
      {accounts.map((account) => {
        const isExpanded = expandedId === account.id;
        return (
          <div key={account.id}>
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-secondary/30 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : account.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-muted-foreground">
                  {isExpanded ? "\u25BC" : "\u25B6"}
                </span>
                <span className="text-xs font-mono text-foreground truncate">
                  {account.email}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(account.unreadCount ?? 0) > 0 && (
                  <span className="bg-destructive text-destructive-foreground text-[9px] px-1.5 py-0.5 rounded-full font-semibold">
                    {account.unreadCount}
                  </span>
                )}
                <button
                  type="button"
                  className="text-primary hover:text-primary/80 text-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(account.email);
                  }}
                  title="Copy"
                >
                  \u{1F4CB}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive text-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteAccount.mutate(account.id);
                  }}
                  title="Delete"
                >
                  \u{1F5D1}
                </button>
              </div>
            </div>
            {isExpanded && <MessageList accountId={account.id} />}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Rewrite the main App component**

Replace `apps/extension/entrypoints/popup/App.tsx`:

```typescript
import { Header } from "./components/header";
import { AccountList } from "./components/account-list";
import { EmptyState } from "./components/empty-state";
import { useEmailAccounts, useGenerateEmail } from "./hooks/use-api";

export default function App() {
  const { data, isLoading } = useEmailAccounts();
  const generateEmail = useGenerateEmail();

  const accounts = data?.ok ? data.data : [];

  return (
    <main className="min-w-[320px] max-h-[500px] overflow-y-auto bg-background text-foreground">
      <Header
        onGenerate={() => generateEmail.mutate()}
        isGenerating={generateEmail.isPending}
      />
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          onGenerate={() => generateEmail.mutate()}
          isGenerating={generateEmail.isPending}
        />
      ) : (
        <AccountList accounts={accounts} />
      )}
      {generateEmail.isError && (
        <div className="px-4 py-2 text-xs text-destructive">
          Failed to generate email. Try again.
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 8: Verify build**

```bash
pnpm --filter extension build
```

Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add apps/extension/
git commit -m "feat(extension): accordion inbox popup with TanStack Query"
```

---

## Task 11: Content Script — Email Field Detection + Icon + Panel

**Files:**
- Create: `apps/extension/entrypoints/content.ts`
- Create: `apps/extension/entrypoints/content/icon.ts`
- Create: `apps/extension/entrypoints/content/panel.ts`
- Modify: `apps/extension/wxt.config.ts`

- [ ] **Step 1: Add content script permissions to manifest**

In `apps/extension/wxt.config.ts`, update the manifest to add `scripting` and `tabs` permissions, and add `host_permissions` for all URLs (needed for content script injection):

```typescript
  manifest: {
    name: "burner-kit",
    description: "Disposable credential vault",
    permissions: ["storage", "activeTab"],
    host_permissions: ["http://localhost:8787/*", "<all_urls>"],
    // ... key stays the same
  },
```

- [ ] **Step 2: Create the content script entry point**

Create `apps/extension/entrypoints/content.ts`:

```typescript
import { attachIcons, observeNewInputs } from "./content/icon";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    attachIcons();
    observeNewInputs();
  },
});
```

- [ ] **Step 3: Create the icon module (Shadow DOM)**

Create `apps/extension/entrypoints/content/icon.ts`:

```typescript
import { showPanel, hidePanel } from "./panel";

const ICON_SIZE = 16;
const SELECTORS = [
  'input[type="email"]',
  'input[autocomplete="email"]',
];
const NAME_REGEX = /email/i;

const processed = new WeakSet<HTMLInputElement>();

function isEmailInput(el: HTMLInputElement): boolean {
  if (el.type === "email") return true;
  if (el.autocomplete === "email") return true;
  if (NAME_REGEX.test(el.name)) return true;
  if (NAME_REGEX.test(el.placeholder)) return true;
  return false;
}

function findEmailInputs(): HTMLInputElement[] {
  const bySelector = Array.from(
    document.querySelectorAll<HTMLInputElement>(SELECTORS.join(",")),
  );
  const byName = Array.from(
    document.querySelectorAll<HTMLInputElement>("input"),
  ).filter((el) => !bySelector.includes(el) && isEmailInput(el));
  return [...bySelector, ...byName];
}

function createIcon(input: HTMLInputElement): HTMLDivElement {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "auto";

  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    .bk-icon {
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
      background: #3b82f6;
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      font-weight: 700;
      color: white;
      font-family: system-ui, sans-serif;
      opacity: 0;
      transition: opacity 150ms;
      user-select: none;
    }
    .bk-icon.visible {
      opacity: 1;
    }
    .bk-icon:hover {
      background: #2563eb;
    }
  `;

  const icon = document.createElement("div");
  icon.className = "bk-icon";
  icon.textContent = "B";
  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    showPanel(input, host);
  });

  shadow.appendChild(style);
  shadow.appendChild(icon);

  function position() {
    const rect = input.getBoundingClientRect();
    host.style.top = `${window.scrollY + rect.top + (rect.height - ICON_SIZE) / 2}px`;
    host.style.left = `${window.scrollX + rect.right - ICON_SIZE - 8}px`;
  }

  function show() {
    position();
    icon.classList.add("visible");
  }

  function hide() {
    setTimeout(() => {
      if (document.activeElement !== input) {
        icon.classList.remove("visible");
        hidePanel();
      }
    }, 200);
  }

  input.addEventListener("focus", show);
  input.addEventListener("mouseenter", show);
  input.addEventListener("blur", hide);
  input.addEventListener("mouseleave", hide);

  document.body.appendChild(host);
  return host;
}

export function attachIcons() {
  for (const input of findEmailInputs()) {
    if (processed.has(input)) continue;
    processed.add(input);
    createIcon(input);
  }
}

let debounceTimer: ReturnType<typeof setTimeout>;

export function observeNewInputs() {
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(attachIcons, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
```

- [ ] **Step 4: Create the panel module (Shadow DOM)**

Create `apps/extension/entrypoints/content/panel.ts`:

```typescript
import type { EmailAccount, ApiResult } from "@/lib/api-client";

let panelHost: HTMLDivElement | null = null;
let currentInput: HTMLInputElement | null = null;

function fillInput(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderPanel(
  shadow: ShadowRoot,
  input: HTMLInputElement,
  accounts: EmailAccount[],
) {
  shadow.innerHTML = "";

  const style = document.createElement("style");
  style.textContent = `
    .bk-panel {
      width: 320px;
      background: #111113;
      border: 1px solid #232329;
      border-radius: 8px;
      padding: 12px;
      font-family: system-ui, sans-serif;
      color: #ededef;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .bk-panel * { box-sizing: border-box; }
    .bk-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
    }
    .bk-logo {
      width: 18px; height: 18px;
      background: #3b82f6;
      border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; color: white;
    }
    .bk-title { font-size: 12px; font-weight: 600; }
    .bk-generate {
      width: 100%;
      padding: 8px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      margin-bottom: 8px;
    }
    .bk-generate:hover { background: #2563eb; }
    .bk-generate:disabled { opacity: 0.6; cursor: wait; }
    .bk-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b6b76; margin-bottom: 4px; }
    .bk-item {
      padding: 6px 8px;
      background: #18181b;
      border: 1px solid #232329;
      border-radius: 6px;
      margin-bottom: 4px;
      cursor: pointer;
      font-size: 11px;
      font-family: monospace;
    }
    .bk-item:hover { border-color: #3b82f6; }
  `;
  shadow.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "bk-panel";

  // Header
  const header = document.createElement("div");
  header.className = "bk-header";
  header.innerHTML = `<div class="bk-logo">B</div><span class="bk-title">Burner Kit</span>`;
  panel.appendChild(header);

  // Generate button
  const btn = document.createElement("button");
  btn.className = "bk-generate";
  btn.textContent = "Generate new burner email";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Generating...";
    const result: ApiResult<EmailAccount> = await chrome.runtime.sendMessage({
      type: "GENERATE_EMAIL",
    });
    if (result.ok) {
      fillInput(input, result.data.email);
      hidePanel();
    } else {
      btn.textContent = "Failed — try again";
      btn.disabled = false;
    }
  });
  panel.appendChild(btn);

  // Recent accounts
  if (accounts.length > 0) {
    const label = document.createElement("div");
    label.className = "bk-label";
    label.textContent = "Recent";
    panel.appendChild(label);

    for (const account of accounts.slice(0, 5)) {
      const item = document.createElement("div");
      item.className = "bk-item";
      item.textContent = account.email;
      item.addEventListener("click", () => {
        fillInput(input, account.email);
        hidePanel();
      });
      panel.appendChild(item);
    }
  }

  shadow.appendChild(panel);
}

export async function showPanel(input: HTMLInputElement, iconHost: HTMLDivElement) {
  hidePanel();
  currentInput = input;

  panelHost = document.createElement("div");
  panelHost.style.position = "absolute";
  panelHost.style.zIndex = "2147483647";

  const rect = input.getBoundingClientRect();
  panelHost.style.top = `${window.scrollY + rect.bottom + 4}px`;
  panelHost.style.left = `${window.scrollX + rect.left}px`;

  const shadow = panelHost.attachShadow({ mode: "closed" });

  // Fetch accounts
  const result: ApiResult<EmailAccount[]> = await chrome.runtime.sendMessage({
    type: "GET_EMAIL_ACCOUNTS",
  });
  const accounts = result.ok ? result.data : [];

  renderPanel(shadow, input, accounts);

  document.body.appendChild(panelHost);

  // Close on outside click
  function onClickOutside(e: MouseEvent) {
    if (panelHost && !panelHost.contains(e.target as Node) && e.target !== iconHost) {
      hidePanel();
      document.removeEventListener("click", onClickOutside);
    }
  }
  setTimeout(() => document.addEventListener("click", onClickOutside), 0);

  // Close on Escape
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      hidePanel();
      document.removeEventListener("keydown", onKeydown);
    }
  }
  document.addEventListener("keydown", onKeydown);
}

export function hidePanel() {
  if (panelHost) {
    panelHost.remove();
    panelHost = null;
  }
  currentInput = null;
}
```

- [ ] **Step 5: Verify build**

```bash
pnpm --filter extension build
```

Expected: Build succeeds. The content script should be listed in the build output.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/
git commit -m "feat(extension): add content script with email field icon + panel"
```

---

## Task 12: End-to-End Smoke Test

**Files:** None (testing only)

- [ ] **Step 1: Start both dev servers**

```bash
pnpm dev
```

Expected: Both worker (port 8787) and extension dev server start.

- [ ] **Step 2: Apply database migration**

```bash
cd apps/worker
pnpm db:migrate:local
```

- [ ] **Step 3: Load the extension and test the popup**

1. Open Chrome, go to `chrome://extensions`
2. Enable Developer Mode
3. Load unpacked from `apps/extension/.output/chrome-mv3`
4. Click the extension icon — should see the empty state with "Generate Burner Email" button
5. Click "Generate Burner Email" �� should create a new email via mail.tm and show it in the accordion
6. Click the email to expand — should show "No messages yet" (or any received messages)

- [ ] **Step 4: Test the content script**

1. Navigate to any page with an email input (e.g., a signup form)
2. Focus the email input — should see the small blue "B" icon appear near the right edge
3. Click the icon — should see the panel with "Generate new" + any recent burners
4. Click "Generate new" — should fill the input with a new burner email
5. Verify the icon doesn't appear on password fields

- [ ] **Step 5: Test error handling**

1. Stop the worker (`Ctrl+C`)
2. Try generating an email from the popup — should show error message
3. Restart the worker — should recover on next attempt

- [ ] **Step 6: Run typecheck across the whole project**

```bash
pnpm typecheck
```

Expected: No type errors in either workspace.

- [ ] **Step 7: Run lint and format**

```bash
pnpm lint
pnpm format
```

Fix any lint or format issues.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint/format issues from smoke test"
```
