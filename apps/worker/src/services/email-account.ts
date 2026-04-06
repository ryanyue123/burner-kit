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
    readonly create: (
      userId: string,
    ) => Effect.Effect<typeof schema.emailAccount.$inferSelect, MailTmError>;
    readonly list: (
      userId: string,
    ) => Effect.Effect<
      ReadonlyArray<typeof schema.emailAccount.$inferSelect & { unreadCount: number }>
    >;
    readonly get: (
      userId: string,
      accountId: string,
    ) => Effect.Effect<typeof schema.emailAccount.$inferSelect, EmailAccountNotFoundError>;
    readonly remove: (
      userId: string,
      accountId: string,
    ) => Effect.Effect<void, EmailAccountNotFoundError>;
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

      const getAccount = (userId: string, accountId: string) =>
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
            row ? Effect.succeed(row) : Effect.fail(new EmailAccountNotFoundError({ accountId })),
          ),
        );

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

            yield* Effect.tryPromise({
              try: () => db.insert(schema.emailAccount).values(row),
              catch: (e) => e as Error,
            }).pipe(Effect.orDie);

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

        get: getAccount,

        remove: (userId: string, accountId: string) =>
          Effect.gen(function* () {
            const account = yield* getAccount(userId, accountId);
            yield* Effect.tryPromise({
              try: () =>
                db.delete(schema.emailAccount).where(eq(schema.emailAccount.id, account.id)),
              catch: (e) => e as Error,
            }).pipe(Effect.orDie);
          }),

        update: (
          userId: string,
          accountId: string,
          data: { label?: string | null; expiresAt?: Date | null },
        ) =>
          Effect.gen(function* () {
            yield* getAccount(userId, accountId);
            const updates: Record<string, unknown> = {};
            if ("label" in data) updates["label"] = data.label;
            if ("expiresAt" in data) updates["expiresAt"] = data.expiresAt;
            yield* Effect.tryPromise({
              try: () =>
                db
                  .update(schema.emailAccount)
                  .set(updates)
                  .where(eq(schema.emailAccount.id, accountId)),
              catch: (e) => e as Error,
            }).pipe(Effect.orDie);
            return yield* getAccount(userId, accountId);
          }),
      };
    }),
  );
