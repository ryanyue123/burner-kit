import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "@effect/platform";
import { BurnerKitApi } from "./api";
import { CurrentUser } from "./middleware";
import { EmailAccountService } from "./services/email-account";
import { EmailMessageService } from "./services/email-message";
import { Db, query } from "./services/db";
import { and, desc, eq, gt, isNull, isNotNull, or } from "drizzle-orm";
import * as schema from "./db/schema";
import { EmailMessageNotFoundError } from "./errors";

// ── Mappers ───────────────────────────────────────────────────

const toAccountResponse = (
  row: typeof schema.emailAccount.$inferSelect & { messageCount?: number; unreadCount?: number },
) => ({
  id: row.id,
  email: row.email,
  domain: row.domain,
  label: row.label,
  createdAt: row.createdAt.getTime(),
  expiresAt: row.expiresAt?.getTime() ?? null,
  messageCount: row.messageCount,
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
  extractedCode: row.extractedCode,
  extractionStatus: row.extractionStatus,
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

// ── Codes handlers ─────────────────────────────────────────────

export const CodesHandlersLive = HttpApiBuilder.group(BurnerKitApi, "codes", (handlers) =>
  handlers.handle("latest", () =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      const db = yield* Db;
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      const now = new Date();

      const rows = yield* query(
        () =>
          db
            .select({
              code: schema.emailMessage.extractedCode,
              fromAddress: schema.emailMessage.fromAddress,
              receivedAt: schema.emailMessage.receivedAt,
            })
            .from(schema.emailMessage)
            .innerJoin(
              schema.emailAccount,
              eq(schema.emailMessage.emailAccountId, schema.emailAccount.id),
            )
            .where(
              and(
                eq(schema.emailAccount.userId, user.id),
                or(isNull(schema.emailAccount.expiresAt), gt(schema.emailAccount.expiresAt, now)),
                isNotNull(schema.emailMessage.extractedCode),
                eq(schema.emailMessage.isRead, false),
                gt(schema.emailMessage.receivedAt, tenMinAgo),
              ),
            )
            .orderBy(desc(schema.emailMessage.receivedAt))
            .limit(1),
        "codes/latest query",
      );

      const row = rows[0];
      if (!row || row.code === null) {
        return yield* Effect.fail(new EmailMessageNotFoundError({ messageId: "no-fresh-code" }));
      }

      return {
        code: row.code,
        fromAddress: row.fromAddress,
        receivedAt: row.receivedAt.getTime(),
      };
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

export const HandlersLive = Layer.mergeAll(
  EmailAccountsHandlersLive,
  CodesHandlersLive,
  MiscHandlersLive,
);
