import { Context, Effect, Layer } from "effect";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import { Db, query } from "./db";
import { MailTm } from "./mail-tm";
import { OtpQueue } from "./extraction";
import { DatabaseError, EmailAccountNotFoundError, EmailMessageNotFoundError } from "../errors";
import { EmailAccountService } from "./email-account";

export class EmailMessageService extends Context.Tag("EmailMessageService")<
  EmailMessageService,
  {
    readonly syncAndList: (
      userId: string,
      accountId: string,
    ) => Effect.Effect<
      ReadonlyArray<typeof schema.emailMessage.$inferSelect>,
      EmailAccountNotFoundError | DatabaseError
    >;
    readonly get: (
      userId: string,
      accountId: string,
      messageId: string,
    ) => Effect.Effect<
      typeof schema.emailMessage.$inferSelect,
      EmailAccountNotFoundError | EmailMessageNotFoundError | DatabaseError
    >;
    readonly markRead: (
      userId: string,
      accountId: string,
      messageId: string,
      isRead: boolean,
    ) => Effect.Effect<
      typeof schema.emailMessage.$inferSelect,
      EmailAccountNotFoundError | EmailMessageNotFoundError | DatabaseError
    >;
    readonly syncAccountInternal: (
      account: typeof schema.emailAccount.$inferSelect,
    ) => Effect.Effect<void, DatabaseError>;
  }
>() {}

export const EmailMessageServiceLive = Layer.effect(
  EmailMessageService,
  Effect.gen(function* () {
    const db = yield* Db;
    const mailTm = yield* MailTm;
    const emailAccountSvc = yield* EmailAccountService;
    const otpQueue = yield* OtpQueue;

    const enqueueExtraction = (messageId: string) =>
      Effect.tryPromise({
        try: () => otpQueue.send({ messageId }),
        catch: (cause) => new DatabaseError({ message: `queue.send failed: ${cause}` }),
      }).pipe(
        Effect.tapError((e) => Effect.logError(String(e))),
        Effect.ignore,
      );

    return {
      syncAndList: (userId: string, accountId: string) =>
        Effect.gen(function* () {
          const account = yield* emailAccountSvc.get(userId, accountId);

          yield* Effect.log(`fetching messages for ${account.email} (account=${accountId})`);

          const mailTmMessages = yield* mailTm
            .getMessages(account.providerToken)
            .pipe(
              Effect.catchAll((e) =>
                Effect.logError(`mail.tm list failed for ${account.email}: ${e}`).pipe(
                  Effect.map(() => ({ "hydra:member": [] as never[] })),
                ),
              ),
            );

          const remote = mailTmMessages["hydra:member"];
          yield* Effect.log(`mail.tm returned ${remote.length} message(s) for ${account.email}`);

          let inserted = 0;
          for (const msg of remote) {
            const existing = yield* query(() =>
              db.query.emailMessage.findFirst({
                where: eq(schema.emailMessage.id, msg.id),
              }),
            );

            const needsContent =
              !existing || (existing.textContent === null && existing.htmlContent === null);

            if (needsContent) {
              yield* Effect.log(
                `fetching full content for message ${msg.id} (subject=${msg.subject ?? "(none)"}${existing ? ", backfill" : ""})`,
              );
              const fullMsg = yield* mailTm
                .getMessage(account.providerToken, msg.id)
                .pipe(
                  Effect.catchAll((e) =>
                    Effect.logError(`failed to fetch message ${msg.id}, using summary: ${e}`).pipe(
                      Effect.map(() => msg),
                    ),
                  ),
                );

              if (!existing) {
                yield* query(() =>
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
                );
                inserted++;
                yield* enqueueExtraction(msg.id);
              } else {
                yield* query(() =>
                  db
                    .update(schema.emailMessage)
                    .set({
                      subject: fullMsg.subject ?? null,
                      textContent: fullMsg.text ?? null,
                      htmlContent: fullMsg.html ? fullMsg.html.join("") : null,
                      extractionStatus: "pending",
                    })
                    .where(eq(schema.emailMessage.id, msg.id)),
                );
                yield* Effect.log(`backfilled content for message ${msg.id}`);
                yield* enqueueExtraction(msg.id);
              }
            }
          }

          yield* Effect.log(
            `inserted ${inserted} new message(s), ${remote.length - inserted} already cached`,
          );

          const messages = yield* query(() =>
            db.query.emailMessage.findMany({
              where: eq(schema.emailMessage.emailAccountId, accountId),
              orderBy: (m, { desc }) => [desc(m.receivedAt)],
            }),
          );

          yield* Effect.log(`returning ${messages.length} total message(s) from D1`);
          return messages;
        }),

      get: (userId: string, accountId: string, messageId: string) =>
        Effect.gen(function* () {
          yield* emailAccountSvc.get(userId, accountId);
          const message = yield* query(() =>
            db.query.emailMessage.findFirst({
              where: and(
                eq(schema.emailMessage.id, messageId),
                eq(schema.emailMessage.emailAccountId, accountId),
              ),
            }),
          );

          if (!message) {
            return yield* Effect.fail(new EmailMessageNotFoundError({ messageId }));
          }
          return message;
        }),

      markRead: (userId: string, accountId: string, messageId: string, isRead: boolean) =>
        Effect.gen(function* () {
          yield* emailAccountSvc.get(userId, accountId);
          const message = yield* query(() =>
            db.query.emailMessage.findFirst({
              where: and(
                eq(schema.emailMessage.id, messageId),
                eq(schema.emailMessage.emailAccountId, accountId),
              ),
            }),
          );

          if (!message) {
            return yield* Effect.fail(new EmailMessageNotFoundError({ messageId }));
          }

          yield* query(() =>
            db
              .update(schema.emailMessage)
              .set({ isRead })
              .where(eq(schema.emailMessage.id, messageId)),
          );

          return { ...message, isRead };
        }),

      syncAccountInternal: (account: typeof schema.emailAccount.$inferSelect) =>
        Effect.gen(function* () {
          yield* Effect.log(`[cron] syncing ${account.email}`);

          const mailTmMessages = yield* mailTm
            .getMessages(account.providerToken)
            .pipe(
              Effect.catchAll((e) =>
                Effect.logError(`[cron] mail.tm list failed for ${account.email}: ${e}`).pipe(
                  Effect.map(() => ({ "hydra:member": [] as never[] })),
                ),
              ),
            );

          const remote = mailTmMessages["hydra:member"];

          for (const msg of remote) {
            const existing = yield* query(() =>
              db.query.emailMessage.findFirst({
                where: eq(schema.emailMessage.id, msg.id),
              }),
            );

            const needsContent =
              !existing || (existing.textContent === null && existing.htmlContent === null);

            if (!needsContent) continue;

            const fullMsg = yield* mailTm
              .getMessage(account.providerToken, msg.id)
              .pipe(
                Effect.catchAll((e) =>
                  Effect.logError(`[cron] failed to fetch ${msg.id}: ${e}`).pipe(
                    Effect.map(() => msg),
                  ),
                ),
              );

            if (!existing) {
              yield* query(() =>
                db.insert(schema.emailMessage).values({
                  id: msg.id,
                  emailAccountId: account.id,
                  fromAddress: fullMsg.from.address,
                  subject: fullMsg.subject ?? null,
                  textContent: fullMsg.text ?? null,
                  htmlContent: fullMsg.html ? fullMsg.html.join("") : null,
                  receivedAt: new Date(fullMsg.createdAt),
                  isRead: fullMsg.seen,
                }),
              );
              yield* enqueueExtraction(msg.id);
            } else {
              yield* query(() =>
                db
                  .update(schema.emailMessage)
                  .set({
                    subject: fullMsg.subject ?? null,
                    textContent: fullMsg.text ?? null,
                    htmlContent: fullMsg.html ? fullMsg.html.join("") : null,
                    extractionStatus: "pending",
                  })
                  .where(eq(schema.emailMessage.id, msg.id)),
              );
              yield* enqueueExtraction(msg.id);
            }
          }
        }),
    };
  }),
);
