import { Context, Effect, Layer, Schedule, Schema } from "effect";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { Db, query } from "./db";
import { UserChannels } from "./user-channel";
import { DatabaseError, EmailMessageNotFoundError, ExtractionError } from "../errors";

/** Expected AI response shape. The model is asked for `{ code: string | null }`
 *  via `response_format`, but sometimes wraps it in a ```json …``` markdown
 *  fence — strip those before JSON.parse, then validate via Schema. */
const AiCodeResponse = Schema.Struct({
  code: Schema.NullOr(Schema.String),
});

const MARKDOWN_FENCE_HEAD = /^\s*```(?:json)?\s*/;
const MARKDOWN_FENCE_TAIL = /\s*```\s*$/;

/** Retry Workers AI on transient failures: 500ms → 1s → 2s → fail. */
const AI_RETRY = Schedule.exponential("500 millis", 2).pipe(Schedule.intersect(Schedule.recurs(3)));

function parseAiCode(raw: string) {
  return Effect.gen(function* () {
    const stripped = raw.replace(MARKDOWN_FENCE_HEAD, "").replace(MARKDOWN_FENCE_TAIL, "").trim();
    const json = yield* Effect.try({
      try: () => JSON.parse(stripped) as unknown,
      catch: (cause) => new Error(`JSON.parse failed: ${cause} (input: ${stripped.slice(0, 80)})`),
    });
    const decoded = yield* Schema.decodeUnknown(AiCodeResponse)(json);
    return decoded.code;
  });
}

export class CodeQueue extends Context.Tag("CodeQueue")<
  CodeQueue,
  Queue<{ messageId: string }>
>() {}

export class WorkersAi extends Context.Tag("WorkersAi")<WorkersAi, Ai>() {}

export class ExtractionService extends Context.Tag("ExtractionService")<
  ExtractionService,
  {
    readonly extractForMessage: (
      messageId: string,
    ) => Effect.Effect<void, EmailMessageNotFoundError | DatabaseError | ExtractionError>;
  }
>() {}

const SYSTEM_PROMPT =
  "You extract one-time confirmation codes from emails. " +
  "Return only a JSON object with a 'code' field. Codes are " +
  "typically 4-8 characters: digits, letters, or both, sometimes " +
  "hyphenated (e.g. 'A4F-92K'). If multiple codes appear, return " +
  "the one most clearly labeled as verification/confirmation/" +
  "security/one-time. Do NOT return order numbers, tracking " +
  "numbers, prices, or dates. If no code is present, return null.";

const RESPONSE_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "extracted_code",
    schema: {
      type: "object",
      properties: {
        code: { type: ["string", "null"] },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
};

export const ExtractionServiceLive = Layer.effect(
  ExtractionService,
  Effect.gen(function* () {
    const db = yield* Db;
    const ai = yield* WorkersAi;
    const userChannels = yield* UserChannels;

    return {
      extractForMessage: (messageId: string) =>
        Effect.gen(function* () {
          const message = yield* query(() =>
            db.query.emailMessage.findFirst({
              where: eq(schema.emailMessage.id, messageId),
            }),
          );

          if (!message) {
            return yield* Effect.fail(new EmailMessageNotFoundError({ messageId }));
          }

          if (message.extractionStatus === "done") {
            yield* Effect.log(`extraction skip — already done for ${messageId}`);
            return;
          }

          yield* Effect.log(`[latency] extract_start messageId=${messageId} ts=${Date.now()}`);

          const body = message.textContent ?? message.htmlContent ?? "";
          const userContent = `Subject: ${message.subject ?? ""}\nFrom: ${message.fromAddress}\n\n${body}`;

          const aiResponse = yield* Effect.tryPromise({
            try: () =>
              ai.run("@cf/zai-org/glm-4.7-flash", {
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  { role: "user", content: userContent },
                ],
                response_format: RESPONSE_SCHEMA,
              }),
            catch: (cause) => new ExtractionError({ reason: `ai.run failed: ${cause}` }),
          }).pipe(Effect.retry(AI_RETRY));

          const code = yield* parseAiCode(aiResponse.choices[0]?.message?.content ?? "").pipe(
            Effect.catchAll((cause) =>
              Effect.logError(`failed to parse AI response for ${messageId}: ${cause}`).pipe(
                Effect.as<string | null>(null),
              ),
            ),
          );

          yield* Effect.log(`extraction for ${messageId}: code=${code ?? "(none)"}`);
          yield* query(() =>
            db
              .update(schema.emailMessage)
              .set({ extractedCode: code, extractionStatus: "done" })
              .where(eq(schema.emailMessage.id, messageId)),
          );

          yield* Effect.log(
            `[latency] extract_done messageId=${messageId} code=${code ?? "null"} ts=${Date.now()}`,
          );

          const acct = yield* query(() =>
            db.query.emailAccount.findFirst({
              where: eq(schema.emailAccount.id, message.emailAccountId),
              columns: { userId: true },
            }),
          );
          const userId = acct?.userId;
          if (userId) {
            yield* Effect.tryPromise({
              try: () =>
                userChannels.get(userChannels.idFromName(userId)).pushCode({
                  accountId: message.emailAccountId,
                  messageId,
                  code,
                }),
              catch: (cause) => cause,
            }).pipe(
              Effect.catchAll((cause) =>
                Effect.logError(`pushCode failed for ${messageId}: ${cause}`),
              ),
            );
          }
        }),
    };
  }),
);
