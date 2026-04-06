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

            console.log(`[sync] fetching messages for ${account.email} (account=${accountId})`);

            // Fetch from mail.tm
            const mailTmMessages = yield* mailTm
              .getMessages(account.providerToken)
              .pipe(
                Effect.catchAll((e) => {
                  console.error(`[sync] mail.tm list failed for ${account.email}:`, e);
                  return Effect.succeed({ "hydra:member": [] as never[] });
                }),
              );

            const remote = mailTmMessages["hydra:member"];
            console.log(`[sync] mail.tm returned ${remote.length} message(s) for ${account.email}`);

            // Upsert new messages into D1
            let inserted = 0;
            for (const msg of remote) {
              const existing = yield* Effect.tryPromise({
                try: () =>
                  db.query.emailMessage.findFirst({
                    where: eq(schema.emailMessage.id, msg.id),
                  }),
                catch: (e) => e as Error,
              }).pipe(Effect.orDie);

              // Fetch full message content (list endpoint omits text/html body)
              const needsContent =
                !existing || (existing.textContent === null && existing.htmlContent === null);

              if (needsContent) {
                console.log(
                  `[sync] fetching full content for message ${msg.id} (subject=${msg.subject ?? "(none)"}${existing ? ", backfill" : ""})`,
                );
                const fullMsg = yield* mailTm
                  .getMessage(account.providerToken, msg.id)
                  .pipe(
                    Effect.catchAll((e) => {
                      console.error(`[sync] failed to fetch message ${msg.id}, using summary:`, e);
                      return Effect.succeed(msg);
                    }),
                  );

                if (!existing) {
                  yield* Effect.tryPromise({
                    try: () =>
                      db.insert(schema.emailMessage).values({
                        id: msg.id,
                        emailAccountId: accountId,
                        fromAddress: fullMsg.from.address,
                        subject: fullMsg.subject ?? null,
                        textContent: fullMsg.text ?? null,
                        htmlContent: fullMsg.html ? fullMsg.html.join("") : null,
                        receivedAt: new Date(fullMsg.createdAt),
                        isRead: fullMsg.seen,
                      }),
                    catch: (e) => e as Error,
                  }).pipe(Effect.orDie);
                  inserted++;
                } else {
                  // Backfill content for previously synced messages
                  yield* Effect.tryPromise({
                    try: () =>
                      db
                        .update(schema.emailMessage)
                        .set({
                          subject: fullMsg.subject ?? null,
                          textContent: fullMsg.text ?? null,
                          htmlContent: fullMsg.html ? fullMsg.html.join("") : null,
                        })
                        .where(eq(schema.emailMessage.id, msg.id)),
                    catch: (e) => e as Error,
                  }).pipe(Effect.orDie);
                  console.log(`[sync] backfilled content for message ${msg.id}`);
                }
              }
            }

            console.log(`[sync] inserted ${inserted} new message(s), ${remote.length - inserted} already cached`);

            // Return all from D1
            const messages = yield* Effect.tryPromise({
              try: () =>
                db.query.emailMessage.findMany({
                  where: eq(schema.emailMessage.emailAccountId, accountId),
                  orderBy: (m, { desc }) => [desc(m.receivedAt)],
                }),
              catch: (e) => e as Error,
            }).pipe(Effect.orDie);

            console.log(`[sync] returning ${messages.length} total message(s) from D1`);
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
