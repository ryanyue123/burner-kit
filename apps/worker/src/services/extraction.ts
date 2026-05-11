import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { Db, query } from "./db";
import { DatabaseError, EmailMessageNotFoundError, ExtractionError } from "../errors";

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
          });

          const code = yield* Effect.try({
            try: () => {
              const raw = aiResponse.choices[0]?.message?.content ?? "";
              const parsed = JSON.parse(raw) as { code: string | null };
              return typeof parsed.code === "string" || parsed.code === null ? parsed.code : null;
            },
            catch: (cause) => cause,
          }).pipe(
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
        }),
    };
  }),
);
