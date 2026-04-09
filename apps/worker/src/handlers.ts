import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "@effect/platform";
import { BurnerKitApi } from "./api";
import { CurrentUser } from "./middleware";
import { EmailAccountService } from "./services/email-account";
import { EmailMessageService } from "./services/email-message";
import type * as schema from "./db/schema";

// ── Mappers ───────────────────────────────────────────────────

const toAccountResponse = (
  row: typeof schema.emailAccount.$inferSelect & { unreadCount?: number },
) => ({
  id: row.id,
  email: row.email,
  domain: row.domain,
  label: row.label,
  createdAt: row.createdAt.getTime(),
  expiresAt: row.expiresAt?.getTime() ?? null,
  unreadCount: row.unreadCount,
});

const toMessageResponse = (row: typeof schema.emailMessage.$inferSelect) => ({
  id: row.id,
  emailAccountId: row.emailAccountId,
  fromAddress: row.fromAddress,
  subject: row.subject,
  textContent: row.textContent,
  htmlContent: row.htmlContent,
  receivedAt: row.receivedAt.getTime(),
  isRead: row.isRead,
});

// ── Email accounts handlers ───────────────────────────────────

export const EmailAccountsHandlersLive = HttpApiBuilder.group(
  BurnerKitApi,
  "emailAccounts",
  (handlers) =>
    handlers
      .handle("create", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const svc = yield* EmailAccountService;
          const row = yield* svc.create(user.id);
          return toAccountResponse(row);
        }),
      )
      .handle("list", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const svc = yield* EmailAccountService;
          const rows = yield* svc.list(user.id);
          return rows.map(toAccountResponse);
        }),
      )
      .handle("remove", ({ path }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const svc = yield* EmailAccountService;
          yield* svc.remove(user.id, path.id);
        }),
      )
      .handle("update", ({ path, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const svc = yield* EmailAccountService;
          const row = yield* svc.update(user.id, path.id, {
            label: payload.label,
            expiresAt: payload.expiresAt != null ? new Date(payload.expiresAt) : null,
          });
          return toAccountResponse(row);
        }),
      )
      .handle("listMessages", ({ path }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const svc = yield* EmailMessageService;
          const rows = yield* svc.syncAndList(user.id, path.id);
          return rows.map(toMessageResponse);
        }),
      )
      .handle("getMessage", ({ path }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const svc = yield* EmailMessageService;
          const row = yield* svc.get(user.id, path.id, path.msgId);
          return toMessageResponse(row);
        }),
      )
      .handle("markRead", ({ path, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const svc = yield* EmailMessageService;
          const row = yield* svc.markRead(user.id, path.id, path.msgId, payload.isRead);
          return toMessageResponse(row);
        }),
      ),
);

// ── Misc handlers (health + me) ──────────────────────────────

export const MiscHandlersLive = HttpApiBuilder.group(BurnerKitApi, "misc", (handlers) =>
  handlers
    .handle("health", () => Effect.succeed({ ok: true as const, service: "burner-kit-worker" }))
    .handle("me", () =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        return {
          userId: user.id,
          createdAt: user.createdAt.getTime(),
          isAnonymous: user.isAnonymous ?? false,
        };
      }),
    ),
);

// ── Combined layer ────────────────────────────────────────────

export const HandlersLive = Layer.mergeAll(EmailAccountsHandlersLive, MiscHandlersLive);
