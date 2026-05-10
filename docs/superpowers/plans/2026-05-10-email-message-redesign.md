# Email & Message UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the accordion-based account/message popup UI with a drill-in 3-screen navigation (account list → message list → message view).

**Architecture:** TanStack Router with `createMemoryHistory` manages navigation across three routes: `/` (accounts), `/accounts/$accountId` (messages), `/accounts/$accountId/messages/$messageId` (message view). Each route renders a full-width screen component. Existing UI primitives (`Button`, `Badge`) are reused throughout.

**Tech Stack:** React 19, TailwindCSS v4, Lucide icons, TanStack React Query, TanStack Router (new), DOMPurify (new)

**File structure after implementation:**

```
popup/
├── router.tsx
├── main.tsx
├── routes/
│   ├── accounts.tsx
│   ├── messages.tsx
│   └── message.tsx
├── components/
│   ├── header.tsx
│   ├── account-list.tsx
│   └── empty-state.tsx
└── hooks/
    └── use-api.ts
```

---

### Task 1: Install Dependencies

**Files:**

- Modify: `apps/extension/package.json`

- [ ] **Step 1: Install TanStack Router and DOMPurify**

```bash
cd apps/extension && pnpm add @tanstack/react-router dompurify && pnpm add -D @types/dompurify
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/ryanyue/burner-kit && pnpm run typecheck
```

Expected: passes with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/package.json pnpm-lock.yaml
git commit -m "feat: add tanstack router and dompurify dependencies"
```

---

### Task 2: Set Up Router and Route Tree

**Files:**

- Create: `apps/extension/entrypoints/popup/router.tsx`
- Modify: `apps/extension/entrypoints/popup/main.tsx`

- [ ] **Step 1: Create router.tsx with route definitions**

Create `apps/extension/entrypoints/popup/router.tsx`:

```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
} from "@tanstack/react-router";
import { AccountsRoute } from "./routes/accounts";
import { MessagesRoute } from "./routes/messages";
import { MessageRoute } from "./routes/message";

const rootRoute = createRootRoute({
  component: () => (
    <main className="min-w-[320px] max-h-[500px] overflow-y-auto bg-background text-foreground">
      <Outlet />
    </main>
  ),
});

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: AccountsRoute,
});

const messagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts/$accountId",
  component: MessagesRoute,
});

const messageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts/$accountId/messages/$messageId",
  component: MessageRoute,
});

const routeTree = rootRoute.addChildren([accountsRoute, messagesRoute, messageRoute]);

const memoryHistory = createMemoryHistory({
  initialEntries: ["/"],
});

export const router = createRouter({
  routeTree,
  history: memoryHistory,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] **Step 2: Update main.tsx to use RouterProvider**

Replace the entire contents of `apps/extension/entrypoints/popup/main.tsx` with:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import "../../app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60,
    },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "burner-kit-query-cache",
  throttleTime: 1_000,
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 }}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/extension/entrypoints/popup/router.tsx apps/extension/entrypoints/popup/main.tsx
git commit -m "feat: set up tanstack router with memory history and route tree"
```

Note: This will have type errors until Tasks 3-6 create the route and component files. That's expected.

---

### Task 3: Refactor AccountList Component

**Files:**

- Modify: `apps/extension/entrypoints/popup/components/account-list.tsx`

- [ ] **Step 1: Rewrite account-list.tsx**

Replace the entire contents of `apps/extension/entrypoints/popup/components/account-list.tsx` with:

```tsx
import { useState } from "react";
import { Copy, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeleteAccount } from "../hooks/use-api";
import type { EmailAccount } from "@/lib/api-client";

export function AccountList({
  accounts,
  onSelect,
}: {
  accounts: EmailAccount[];
  onSelect: (accountId: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const deleteAccount = useDeleteAccount();

  function handleCopy(e: React.MouseEvent, account: EmailAccount) {
    e.stopPropagation();
    navigator.clipboard.writeText(account.email);
    setCopiedId(account.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="divide-y divide-border">
      {accounts.map((account) => {
        const isCopied = copiedId === account.id;
        return (
          <div
            key={account.id}
            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-secondary/30 transition-colors"
            onClick={() => onSelect(account.id)}
          >
            <div className="min-w-0">
              <div className="text-xs font-mono text-foreground truncate">{account.email}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {(account.unreadCount ?? 0) > 0 ? `${account.unreadCount} unread` : "No messages"}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              {(account.unreadCount ?? 0) > 0 && (
                <span className="bg-destructive text-destructive-foreground text-[9px] px-1.5 py-0.5 rounded-full font-semibold">
                  {account.unreadCount}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => handleCopy(e, account)}
                title="Copy email"
              >
                {isCopied ? <Check className="text-green-500" /> : <Copy />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteAccount.mutate(account.id);
                }}
                disabled={deleteAccount.isPending}
                title="Delete"
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/extension/entrypoints/popup/components/account-list.tsx
git commit -m "refactor: account list as clickable rows with drill-in callback"
```

---

### Task 4: Create Accounts Route

**Files:**

- Create: `apps/extension/entrypoints/popup/routes/accounts.tsx`
- Delete: `apps/extension/entrypoints/popup/App.tsx`

- [ ] **Step 1: Create routes/accounts.tsx**

Create `apps/extension/entrypoints/popup/routes/accounts.tsx`:

```tsx
import { useNavigate } from "@tanstack/react-router";
import { Header } from "../components/header";
import { AccountList } from "../components/account-list";
import { EmptyState } from "../components/empty-state";
import { useEmailAccounts, useGenerateEmail } from "../hooks/use-api";

export function AccountsRoute() {
  const navigate = useNavigate();
  const { data, isLoading } = useEmailAccounts();
  const generateEmail = useGenerateEmail();

  const accounts = data?.ok ? data.data : [];

  return (
    <>
      <Header onGenerate={() => generateEmail.mutate()} isGenerating={generateEmail.isPending} />
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
        <AccountList
          accounts={accounts}
          onSelect={(accountId) => navigate({ to: "/accounts/$accountId", params: { accountId } })}
        />
      )}
      {generateEmail.isError && (
        <div className="px-4 py-2 text-xs text-destructive">
          Failed to generate email. Try again.
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Delete App.tsx**

```bash
rm apps/extension/entrypoints/popup/App.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/extension/entrypoints/popup/routes/accounts.tsx
git add apps/extension/entrypoints/popup/App.tsx
git commit -m "feat: create accounts route and remove old App.tsx"
```

---

### Task 5: Create Messages Route

**Files:**

- Create: `apps/extension/entrypoints/popup/routes/messages.tsx`
- Delete: `apps/extension/entrypoints/popup/components/message-list.tsx`

- [ ] **Step 1: Create routes/messages.tsx**

Create `apps/extension/entrypoints/popup/routes/messages.tsx`:

```tsx
import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Copy, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages, useMarkRead, useDeleteAccount, useEmailAccounts } from "../hooks/use-api";

export function MessagesRoute() {
  const { accountId } = useParams({ from: "/accounts/$accountId" });
  const navigate = useNavigate();
  const { data: accountsData } = useEmailAccounts();
  const { data, isLoading } = useMessages(accountId, true);
  const markRead = useMarkRead();
  const deleteAccount = useDeleteAccount();
  const [copied, setCopied] = useState(false);

  const accounts = accountsData?.ok ? accountsData.data : [];
  const account = accounts.find((a) => a.id === accountId);
  const email = account?.email ?? "";

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    deleteAccount.mutate(accountId);
    navigate({ to: "/" });
  }

  function handleSelectMessage(messageId: string, isRead: boolean) {
    if (!isRead) {
      markRead.mutate({ accountId, messageId, isRead: true });
    }
    navigate({
      to: "/accounts/$accountId/messages/$messageId",
      params: { accountId, messageId },
    });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate({ to: "/" })} title="Back">
          <ArrowLeft />
        </Button>
        <span className="text-xs font-mono text-foreground truncate flex-1">{email}</span>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon-sm" onClick={handleCopy} title="Copy email">
            {copied ? <Check className="text-green-500" /> : <Copy />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDelete}
            disabled={deleteAccount.isPending}
            title="Delete account"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {/* Messages */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading...
        </div>
      ) : !data?.ok ? (
        <div className="p-3 text-xs text-destructive">Failed to load messages</div>
      ) : data.data.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          No messages yet
        </div>
      ) : (
        <div className="divide-y divide-border">
          {data.data.map((msg) => (
            <button
              key={msg.id}
              type="button"
              onClick={() => handleSelectMessage(msg.id, msg.isRead)}
              className="w-full text-left px-4 py-3 hover:bg-secondary/30 transition-colors"
            >
              <div
                className={`text-xs truncate ${msg.isRead ? "text-muted-foreground" : "text-foreground font-semibold"}`}
              >
                {msg.subject ?? "(no subject)"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {msg.fromAddress} ·{" "}
                {new Date(msg.receivedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Delete the old message-list.tsx**

```bash
rm apps/extension/entrypoints/popup/components/message-list.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/extension/entrypoints/popup/routes/messages.tsx
git add apps/extension/entrypoints/popup/components/message-list.tsx
git commit -m "feat: create messages route with router params and back navigation"
```

---

### Task 6: Create Message Route with DOMPurify

**Files:**

- Create: `apps/extension/entrypoints/popup/routes/message.tsx`
- Delete: `apps/extension/entrypoints/popup/components/message-view.tsx`

- [ ] **Step 1: Create routes/message.tsx**

Create `apps/extension/entrypoints/popup/routes/message.tsx`:

```tsx
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "../hooks/use-api";
import DOMPurify from "dompurify";

export function MessageRoute() {
  const { accountId, messageId } = useParams({
    from: "/accounts/$accountId/messages/$messageId",
  });
  const navigate = useNavigate();
  const { data } = useMessages(accountId, true);
  const messages = data?.ok ? data.data : [];
  const message = messages.find((m) => m.id === messageId);

  if (!message) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Message not found
      </div>
    );
  }

  const sanitizedHtml = message.htmlContent ? DOMPurify.sanitize(message.htmlContent) : null;

  const srcdoc = sanitizedHtml
    ? `<!DOCTYPE html><html><head><base target="_blank"><meta http-equiv="Content-Security-Policy" content="script-src 'none';"><style>body{margin:0;padding:12px;font-family:system-ui,sans-serif;font-size:14px;color:#333;background:#fff;}</style></head><body>${sanitizedHtml}</body></html>`
    : null;

  return (
    <div className="flex flex-col max-h-[500px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate({ to: "/accounts/$accountId", params: { accountId } })}
          title="Back to messages"
        >
          <ArrowLeft />
        </Button>
        <span className="text-xs text-muted-foreground">Back to messages</span>
      </div>

      {/* Metadata */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold text-foreground">
          {message.subject ?? "(no subject)"}
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          {message.fromAddress} ·{" "}
          {new Date(message.receivedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {srcdoc ? (
          <iframe
            srcdoc={srcdoc}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className="w-full min-h-[200px] border border-border rounded bg-white"
            title="Email content"
          />
        ) : (
          <pre className="text-xs text-foreground whitespace-pre-wrap break-words bg-secondary/50 rounded p-3">
            {message.textContent ?? "(empty message)"}
          </pre>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the old message-view.tsx**

```bash
rm apps/extension/entrypoints/popup/components/message-view.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/extension/entrypoints/popup/routes/message.tsx
git add apps/extension/entrypoints/popup/components/message-view.tsx
git commit -m "feat: create message route with DOMPurify and tightened iframe sandbox"
```

---

### Task 7: Verify and Clean Up

**Files:**

- Modify: None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
cd /Users/ryanyue/burner-kit && pnpm run typecheck
```

Expected: passes with no errors.

- [ ] **Step 2: Run lint**

```bash
cd /Users/ryanyue/burner-kit && pnpm run lint
```

Expected: no new errors.

- [ ] **Step 3: Run format check**

```bash
cd /Users/ryanyue/burner-kit && pnpm run format:check
```

If it fails, run `pnpm run format` and commit the formatting changes.

- [ ] **Step 4: Build the extension**

```bash
cd /Users/ryanyue/burner-kit && pnpm run build
```

Expected: builds successfully.

- [ ] **Step 5: Manual testing**

Load the extension in Chrome (`chrome://extensions` → Load unpacked → `.output/chrome-mv3`):

1. Open popup — should see account list with header and "+ New" button
2. Click an account row — should drill into message list with back arrow + email in header
3. Click back arrow — should return to account list
4. Click a message — should drill into message view with subject, sender, time, and email body
5. Click back — should return to message list
6. Copy button — should copy email and show checkmark feedback
7. Delete button — should delete account and return to account list
8. Unread messages — should show bold subject, unread badge on account row
9. HTML email — should render in iframe with links opening in new tabs
10. Plain text email — should render in monospace pre block

- [ ] **Step 6: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```

Only create this commit if fixes were needed.
