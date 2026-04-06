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
              Effect.catchAll(() => Effect.succeed({ "hydra:member": [] as never[] })),
            );

            // Upsert new messages into D1
            for (const msg of mailTmMessages["hydra:member"]) {
              const existing = yield* Effect.tryPromise({
                try: () =>
                  db.query.emailMessage.findFirst({
                    where: eq(schema.emailMessage.id, msg.id),
                  }),
                catch: (e) => e as Error,
              }).pipe(Effect.orDie);

              if (!existing) {
                yield* Effect.tryPromise({
                  try: () =>
                    db.insert(schema.emailMessage).values({
                      id: msg.id,
                      emailAccountId: accountId,
                      fromAddress: msg.from.address,
                      subject: msg.subject ?? null,
                      textContent: msg.text ?? null,
                      htmlContent: msg.html ? msg.html.join("") : null,
                      receivedAt: new Date(msg.createdAt),
                      isRead: msg.seen,
                    }),
                  catch: (e) => e as Error,
                }).pipe(Effect.orDie);
              }
            }

            // Return all from D1
            const messages = yield* Effect.tryPromise({
              try: () =>
                db.query.emailMessage.findMany({
                  where: eq(schema.emailMessage.emailAccountId, accountId),
                  orderBy: (m, { desc }) => [desc(m.receivedAt)],
                }),
              catch: (e) => e as Error,
            }).pipe(Effect.orDie);

            return messages;
          }),

        get: (userId: string, accountId: string, messageId: string) =>
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

            yield* Effect.tryPromise({
              try: () =>
                db
                  .update(schema.emailMessage)
                  .set({ isRead })
                  .where(eq(schema.emailMessage.id, messageId)),
              catch: (e) => e as Error,
            }).pipe(Effect.orDie);

            return { ...message, isRead };
          }),
      };
    }),
  );
