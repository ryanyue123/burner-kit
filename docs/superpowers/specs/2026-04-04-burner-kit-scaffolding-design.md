# burner-kit — Scaffolding Milestone Design

**Date:** 2026-04-04
**Status:** Approved, pending implementation plan
**Scope:** Scaffolding only. No product features.

---

## 1. Product context (for future reference, not this milestone)

burner-kit is a Chrome extension + backend that generates and stores burner credentials — disposable emails, passwords, and phone numbers — for use on sites the user doesn't want to give real information to. Think 1Password, but inverted: instead of vaulting your real identity, it manufactures throwaway ones.

**Long-term north star:** burner emails and phone numbers that actually _receive_ messages (signup confirmation links, SMS OTPs). This drove the backend stack choice — see §3.

**MVP product scope (future milestones, not this one):** generate-and-store only. Plausible fake values the user can paste into sketchy signup forms.

**User model:** single-user for now (just the author), architected so going multi-user is a small, additive lift — not a rewrite.

---

## 2. This milestone's goal

Stand up a provably working vertical slice through the entire stack: monorepo → WXT extension → Cloudflare Worker → Better Auth → D1. No product features. The output is a repo where you can:

1. Run both dev servers with one command.
2. Load the extension in Chrome.
3. Have it auto sign in anonymously against the local Worker on first launch.
4. Hit a single protected endpoint that echoes back the authenticated user.
5. Confirm the session persists across extension service-worker restarts.
6. See the expected rows in the local D1 database.

Once those pass, this milestone is done and all subsequent product work happens on top of a known-good foundation.

---

## 3. Stack decisions

Every decision below was researched against current 2026 documentation and community consensus. See inline rationale.

### 3.1 Extension framework: **WXT**

The 2026 default for modern MV3 web extensions. Handles manifest generation, dev server with HMR, multi-browser builds, React/TS out of the box. Successor to Plasmo in community momentum. ([wxt.dev](https://wxt.dev/))

### 3.2 Backend runtime: **Cloudflare Workers**

Chosen primarily for the **post-MVP roadmap**, not just MVP convenience. Cloudflare is the only realistic stack that gives us **catch-all inbound email → Worker** via CF Email Routing + Email Workers, for free and GA. Supabase and Convex would both work for MVP but force a second backend or third-party email forwarder when we eventually add receiving. Picking CF now avoids that tax. ([CF Email Workers docs](https://developers.cloudflare.com/email-routing/email-workers/))

### 3.3 HTTP framework: **Hono**

The 2026 default for new Workers projects. Web Standards API, extremely small, typed client (`hc`) gives tRPC-comparable type inference without the RPC style, mounts Better Auth as middleware natively. ([Hono](https://hono.dev/), [Better Auth on Cloudflare + Hono](https://hono.dev/examples/better-auth-on-cloudflare))

Rejected alternatives:

- **tRPC**: mature, great DX with React Query, but RPC-style URLs reduce future flexibility (web dashboard, curl) and the CF Workers ecosystem has standardized on Hono.
- **oRPC**: promising, contract-first, OpenAPI-native, but OpenAPI layer is unnecessary overhead for a single-client app.

### 3.4 Database: **Cloudflare D1 + Drizzle**

D1 is GA as of late 2024, 10 GB/DB on Workers Paid, 500 MB on free tier, row-based pricing, no egress charges. Handles this workload with enormous headroom. Drizzle ORM has first-class D1 support and Better Auth shares the same Drizzle instance cleanly. ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/))

### 3.5 Auth: **Better Auth 1.5 with Anonymous plugin**

This is the key decision, and it superseded earlier iterations of this design that proposed hand-rolled device tokens.

**The problem we're solving:** the Worker will sit on a public URL. Without any auth check, anyone who finds the URL can read or write the vault. But for a solo user in MVP, we also don't want a login flow — the extension should "just work" from install with zero interaction.

**The solution:** Better Auth's [Anonymous plugin](https://better-auth.com/docs/plugins/anonymous). On first launch, the extension calls `authClient.signIn.anonymous()`, Better Auth creates a real `user` row and real `session` row, and the extension stores the session token locally. No login UI, no user interaction, and it is actually real auth — cryptographic sessions, expiry, refresh, revocation.

**Why this beats hand-rolling:**

- Battle-tested session management (not a `sha256(random)` string comparison)
- Native D1 support in Better Auth 1.5 — just pass the binding, no adapter
- Official browser extension guide covering `chrome.storage.local` session persistence across MV3 service-worker restarts
- First-class `linkAnonymousUser` API means the upgrade path to real multi-user is a pure config/UI addition, not a migration
- Slotting in passkeys, email/password, or OAuth later is a plugin flip, not a rewrite

### 3.6 Linter / formatter: **Oxlint + Oxfmt (standalone CLIs)**

Both are from VoidZero (the Vite ecosystem's tooling org). Oxlint 1.0 is stable for core linting. Oxfmt is alpha but Prettier-compatible and acceptable risk for a solo project where occasional formatting churn is fine.

**Why not Vite+ as a unified wrapper:** Vite+ is now fully open source and free, but it conflicts with WXT structurally — both are toolchain wrappers that want to own the same layer. WXT doesn't support Vite+ and vice versa. Using the VoidZero tools standalone gives us the same underlying capability (Oxlint, Oxfmt) without the wrapper conflict. Revisit Vite+ as the outer wrapper if/when VoidZero announces WXT support.

**Why not Biome:** strictly a better "boring, safe" choice, but we're deliberately aligning with the Vite/VoidZero ecosystem since WXT is already on Vite.

### 3.7 Package manager: **pnpm** with workspaces

Default for TS monorepos in 2026. Fast, strict, efficient on disk. Workspaces give us a clean path to add packages later when we need genuinely shared code.

### 3.8 Language & runtime

TypeScript everywhere. Node.js for local tooling. Extension runs in the Chrome MV3 service-worker runtime; Worker runs on Cloudflare's V8 isolates runtime. Both are modern JS environments with Web Standards APIs.

---

## 4. Repository layout

```
burner-kit/
├── apps/
│   ├── extension/        # WXT + React + TypeScript
│   │   ├── entrypoints/
│   │   │   ├── background.ts   # Service worker — owns auth client + session
│   │   │   └── popup/          # React popup — calls background via messaging
│   │   ├── wxt.config.ts
│   │   └── package.json
│   └── worker/           # Wrangler + Hono + Better Auth + Drizzle
│       ├── src/
│       │   ├── index.ts        # Hono app, mounts auth + /api/me
│       │   ├── auth.ts         # Better Auth config (anonymous plugin, D1)
│       │   ├── middleware.ts   # requireUser
│       │   └── db/
│       │       └── schema.ts   # Drizzle schema (initially Better Auth tables only)
│       ├── drizzle/            # Generated migrations
│       ├── wrangler.toml
│       └── package.json
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-04-burner-kit-scaffolding-design.md  (this file)
├── package.json          # Root: scripts, devDeps, workspace config
├── pnpm-workspace.yaml
├── .gitignore
└── README.md
```

**No `packages/` directory yet.** We have no shared code. When we introduce the burner generator (used by both the extension preview UI and the server canonical logic), that's when `packages/shared` gets created. YAGNI enforced.

---

## 5. Architecture & data flow

### 5.1 Components

```
┌─────────────────────────────────────┐      ┌──────────────────────────┐
│       Chrome Extension (WXT)        │      │  Cloudflare Worker       │
│                                     │      │                          │
│  ┌─────────────┐   ┌─────────────┐  │      │  ┌────────────────────┐  │
│  │  Popup UI   │──▶│ Background  │──┼─HTTP─┼─▶│  Hono app          │  │
│  │  (React)    │   │  Service    │  │      │  │  ├─ /api/auth/*    │  │
│  └─────────────┘   │  Worker     │  │      │  │  │   (Better Auth) │  │
│                    └─────┬───────┘  │      │  │  └─ /api/me        │  │
│                          │          │      │  │     (requireUser)  │  │
│                          ▼          │      │  └─────────┬──────────┘  │
│                  ┌──────────────┐   │      │            │             │
│                  │ Better Auth  │   │      │  ┌─────────▼──────────┐  │
│                  │   client     │   │      │  │   Drizzle ORM      │  │
│                  │   + storage  │   │      │  └─────────┬──────────┘  │
│                  │   adapter    │   │      │            │             │
│                  └──────┬───────┘   │      │  ┌─────────▼──────────┐  │
│                         │           │      │  │     D1 (SQLite)    │  │
│                  ┌──────▼───────┐   │      │  │  user, session,    │  │
│                  │chrome.storage│   │      │  │  account, verif.   │  │
│                  │   .local     │   │      │  └────────────────────┘  │
│                  └──────────────┘   │      │                          │
└─────────────────────────────────────┘      └──────────────────────────┘
```

**Key constraint:** the background service worker owns the Better Auth client and is the single source of truth for session state. The popup UI never holds session directly — it asks the background via `chrome.runtime.sendMessage`. This is the pattern Better Auth's browser extension guide recommends, and it avoids session state duplication across extension contexts.

### 5.2 First-run flow

1. User installs the extension.
2. Background service worker boots, checks `chrome.storage.local` for an existing Better Auth session → none found.
3. Background calls `authClient.signIn.anonymous()`.
4. Better Auth client POSTs to the Worker's `/api/auth/sign-in/anonymous`.
5. Worker creates a `user` row (anonymous) and a `session` row in D1, returns session token.
6. Better Auth client stores the session in `chrome.storage.local` via the custom storage adapter.
7. Extension is now authenticated, permanently, with zero user interaction.

### 5.3 Normal request flow

1. User opens popup, clicks "Who am I?" button.
2. Popup React component sends a message to the background SW: `{ type: 'GET_ME' }`.
3. Background SW uses Better Auth client to `fetch('/api/me')` — Better Auth attaches the session automatically.
4. Worker's `requireUser` middleware validates the session via Better Auth, sets `c.var.user`.
5. `/api/me` handler returns `{ userId, createdAt, isAnonymous: true }`.
6. Background SW forwards the response back to the popup.
7. Popup renders the user id.

### 5.4 Session persistence across SW restarts

Chrome aggressively terminates MV3 service workers when idle. When the SW restarts:

1. On boot, the background script reads the session from `chrome.storage.local`.
2. Better Auth client hydrates from that stored session.
3. Next API call uses the same session — no re-authentication needed.

This is the critical thing to verify in success criterion #4 below.

---

## 6. Data model

For this milestone, we write **no application schema**. Better Auth owns the only tables that exist:

| Table          | Owner       | Purpose                                                                 |
| -------------- | ----------- | ----------------------------------------------------------------------- |
| `user`         | Better Auth | User identity (will have anonymous flag for MVP rows)                   |
| `session`      | Better Auth | Active sessions, including the extension's persistent one               |
| `account`      | Better Auth | Auth method links (unused for anonymous; prepares for future providers) |
| `verification` | Better Auth | Verification tokens (unused for anonymous; prepares for email/passkey)  |

Better Auth generates its own Drizzle schema from config and runs migrations via `wrangler d1 migrations apply`. We do not author these tables by hand.

The `burners` table — and any other application tables — lands in a **subsequent milestone**, not this one.

**ID strategy:** nanoid for all app-owned IDs when we introduce them. Better Auth's tables use whatever Better Auth uses internally (typically cuid2 or similar — we don't override).

---

## 7. API surface for this milestone

| Method | Path          | Source      | Purpose                                                                   |
| ------ | ------------- | ----------- | ------------------------------------------------------------------------- |
| `*`    | `/api/auth/*` | Better Auth | Handles sign-in, session, etc.                                            |
| `GET`  | `/api/me`     | Our code    | Returns `{ userId, createdAt, isAnonymous }`. Protected by `requireUser`. |

That's it. Two routes. Everything else is out of scope.

---

## 8. Tooling & scripts

### Root `package.json` scripts

- `pnpm dev` — runs both `apps/worker` (`wrangler dev`) and `apps/extension` (`wxt dev`) concurrently
- `pnpm build` — prod builds for both
- `pnpm typecheck` — `tsc --noEmit` across all workspaces
- `pnpm lint` — `oxlint` across all workspaces
- `pnpm format` — `oxfmt --write` across all workspaces
- `pnpm check` — runs typecheck + lint + format check (read-only), for CI/pre-commit
- `pnpm db:migrate` — `wrangler d1 migrations apply` for local D1

### Config files

- `oxlint.json` at repo root with sensible defaults
- `.oxfmtrc` (or equivalent) at repo root — default Prettier-compatible settings
- `tsconfig.base.json` at root, extended by each workspace's `tsconfig.json`
- `.gitignore` excluding `node_modules/`, `.wrangler/`, `.output/`, `dist/`, `.dev.vars`

### Environment variables

- `apps/worker/.dev.vars`:
  - `BETTER_AUTH_SECRET` (random 32 bytes, for signing sessions)
  - `BETTER_AUTH_URL` (local Worker URL, e.g. `http://localhost:8787`)
- `apps/extension/.env.local`:
  - `WXT_API_URL=http://localhost:8787` (injected into extension build)

Production secrets (for a future deploy milestone) will live in `wrangler secret put`.

---

## 9. Success criteria

Scaffolding milestone is done when **all** of the following are demonstrably true:

1. **Fresh clone + install works.** On a fresh machine: `git clone` → `pnpm install` → `pnpm db:migrate` → `pnpm dev` succeeds with no errors.
2. **Both dev servers boot.** `pnpm dev` starts `wrangler dev` on `localhost:8787` and `wxt dev` on its default port, concurrently, without port conflicts.
3. **Extension loads in Chrome.** Loading unpacked from `apps/extension/.output/chrome-mv3` results in a working extension with the popup visible.
4. **Anonymous sign-in works on first launch.** On first install, the extension auto-creates a Better Auth anonymous user without any interaction. Verified by `wrangler d1 execute` showing one row in `user` and one in `session`.
5. **"Who am I?" button returns a real user id.** Clicking the button in the popup shows the authenticated user's id.
6. **Session persists across SW restarts.** Killing the extension's service worker via `chrome://extensions` (or waiting for idle termination) and clicking the button again returns the **same** user id, with no re-authentication.
7. **Type safety end-to-end.** `pnpm typecheck` passes. `pnpm lint` passes. `pnpm format` leaves no pending changes.

When all seven pass, we move on to the first product milestone (burners CRUD).

---

## 10. Explicitly out of scope for this milestone

- `burners` table and any CRUD endpoints
- Burner generation logic (email/password/phone)
- Any popup UI beyond the single "Who am I?" proof-of-life button
- CF Email Routing setup and domain configuration
- Twilio/Telnyx integration for phone numbers
- Production deployment (this is local dev only)
- Encryption at rest for vault data
- Multi-device sync testing
- Passkey / email-password / OAuth auth flows (Better Auth's Anonymous plugin only)
- Tests (unit/integration) — deferred to the first product milestone where there's actual logic to test
- CI/CD
- `packages/shared` workspace — introduced when we have shared code, not before

---

## 11. Risks & open questions

**Risk: Better Auth + WXT service-worker session persistence.** Better Auth has an official browser extension guide, but MV3 service workers are famously fragile around storage APIs. If the custom storage adapter has issues with Chrome's aggressive SW termination, success criterion #6 will fail and we'll need to debug. Mitigation: this is exactly why criterion #6 exists — we want to catch it now, in scaffolding, not after product code is on top of it.

**Risk: Oxfmt alpha edge cases.** Formatter may occasionally produce unexpected output. Mitigation: accept occasional churn; fall back to Prettier for any specific file that consistently breaks.

**Risk: WXT plugin/Vite config conflicts with Better Auth client bundling.** Better Auth's client is designed for normal web apps; running it inside a Chrome MV3 service worker may surface bundler edge cases. Mitigation: the official Better Auth browser extension guide is the starting point; if issues arise, adjustments to WXT's Vite config happen at implementation time.

**Open question — deferred:** exact error handling/UX when the anonymous sign-in fails on first launch (offline, Worker down, etc.). For scaffolding, a console error is acceptable. Real UX comes with the first product milestone.

---

## 12. What comes next

After this milestone ships and criteria are green:

1. **Milestone: burners CRUD** — `burners` table via Drizzle migration, `GET/POST/PATCH/DELETE /api/burners`, server-side generation logic, basic list-and-create UI in the popup.
2. **Milestone: domain + email scaffolding** — purchase domain, wire CF Email Routing catch-all to a stub Email Worker, `inbound_messages` table. (Receiving-messages feature stays behind a flag.)
3. **Milestone: real receive flow** — surface received emails in the extension.
4. **Milestone: multi-user / signup** — enable Better Auth email-password or passkey plugin, add signup UI, use `linkAnonymousUser` to migrate the anonymous user cleanly.

Each is its own spec → plan → implementation cycle.
