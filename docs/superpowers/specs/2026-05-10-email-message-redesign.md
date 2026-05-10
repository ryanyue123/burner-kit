# Email & Message UI Redesign

## Overview

Replace the current accordion-based account/message UI with a drill-in (master-detail) navigation pattern. The popup becomes a 3-screen stack: account list, message list, and message view. This gives each screen full use of the 320x500px popup, reduces visual clutter, and follows the same pattern used by mobile email clients.

## Navigation Model

TanStack Router with `createMemoryHistory` manages navigation across three routes:

- `/` — account list
- `/accounts/$accountId` — message list for an account
- `/accounts/$accountId/messages/$messageId` — single message view

Transitions are instant with no animation. The back button on screens 2 and 3 navigates back one level.

## Dependencies

- `@tanstack/react-router` for in-memory routing
- `dompurify` (+ `@types/dompurify`) for HTML email sanitization

## Screen 1: Account List

The default screen when the popup opens.

**Header:** Burner Kit logo + title (left), "+ New" button (right) — same as today.

**Account rows:** Each row is clickable (drills into message list) and shows:

- Email address (monospace, truncated with ellipsis if needed)
- Secondary text: message count or "No messages"
- Unread badge (existing `Badge` component) — only if unread count > 0
- Copy button (existing icon button with checkmark feedback)
- Delete button (existing icon button)

Copy and delete buttons stop propagation so they don't trigger drill-in.

**Empty state:** Existing `EmptyState` component, unchanged.

## Screen 2: Message List

Shown after clicking an account row.

**Header bar:**

- Back arrow (left) — returns to account list
- Account email address (monospace, truncated)
- Copy and delete buttons for the account (right side)

**Message rows:** Each row is clickable (drills into message view) and shows:

- Subject line — bold if unread, normal weight if read
- Sender address and timestamp on a second line, muted color

No text preview or truncation of message body.

Clicking a row navigates to the message view and calls `markAsRead`.

**Empty state:** Simple centered text — "No messages yet."

## Screen 3: Message View

Shown after clicking a message row.

**Header bar:**

- Back arrow + "Back to messages" text — returns to message list

**Metadata block** (below header, above content):

- Subject line — slightly larger, bold
- Sender address and timestamp, muted color

**Email body:**

- **HTML emails:** Rendered in a sandboxed iframe with tightened security:
  - `sandbox="allow-popups allow-popups-to-escape-sandbox"` (remove `allow-same-origin`)
  - `credentialless=true`
  - `referrerpolicy="no-referrer"`
  - Inject `<base target="_blank">` into srcdoc so links open in new tabs
  - Sanitize HTML with DOMPurify before setting srcdoc
- **Plain text fallback:** Monospace pre-wrap paragraph, same as today

The iframe fills remaining vertical space via flex-grow.

## Components

Reuse existing components wherever possible:

- `Button` (with `icon-sm` variant) for back, copy, delete
- `Badge` for unread count
- `ScrollArea` for message list and account list if they overflow

New components:

- **None.** The three screens are just new views composed from existing primitives. The `AccountList`, `MessageList`, and `MessageView` components get restructured rather than replaced.

## Files Changed

- `apps/extension/entrypoints/popup/App.tsx` — replace accordion orchestration with screen state management
- `apps/extension/entrypoints/popup/components/account-list.tsx` — remove accordion, make rows clickable with drill-in callback
- `apps/extension/entrypoints/popup/components/message-list.tsx` — standalone screen with back button header, remove nesting inside accordion
- `apps/extension/entrypoints/popup/components/message-view.tsx` — standalone screen with back button, add metadata header, tighten iframe sandbox, add DOMPurify sanitization
- `apps/extension/entrypoints/popup/components/header.tsx` — unchanged (stays as global header on account list screen only)

## Dependencies

- Add `dompurify` package for HTML sanitization (+ `@types/dompurify` for types)

## Out of Scope

- Animations or transitions between screens
- Search or filtering
- Account labels or expiration UI
- Changes to the content script panel (icon.ts / panel.ts)
