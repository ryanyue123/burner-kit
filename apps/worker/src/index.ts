import { HttpApiBuilder, HttpMiddleware } from "@effect/platform";
import { Effect, ManagedRuntime } from "effect";
import { createAuth } from "./auth";
import { makeApiLayer, makeServicesLayer } from "./runtime";
import { ExtractionService } from "./services/extraction";
import { drizzle } from "drizzle-orm/d1";
import { gt, isNull, or } from "drizzle-orm";
import * as schema from "./db/schema";
import { EmailMessageService } from "./services/email-message";

function corsHeaders(env: Env) {
  return {
    "Access-Control-Allow-Origin": env.EXTENSION_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "600",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) {
      const auth = createAuth(env);
      const res = await auth.handler(request);
      for (const [k, v] of Object.entries(cors)) {
        res.headers.set(k, v);
      }
      return res;
    }

    const { handler } = HttpApiBuilder.toWebHandler(makeApiLayer(env), {
      middleware: HttpMiddleware.logger,
    });
    const res = await handler(request);

    for (const [k, v] of Object.entries(cors)) {
      res.headers.set(k, v);
    }
    return res;
  },

  async queue(batch: MessageBatch<{ messageId: string }>, env: Env): Promise<void> {
    const runtime = ManagedRuntime.make(makeServicesLayer(env));
    try {
      await runtime.runPromise(
        Effect.forEach(
          batch.messages,
          (msg) =>
            Effect.gen(function* () {
              const svc = yield* ExtractionService;
              yield* svc.extractForMessage(msg.body.messageId);
            }).pipe(
              Effect.matchEffect({
                onSuccess: () => Effect.sync(() => msg.ack()),
                onFailure: (err) =>
                  Effect.sync(() => {
                    console.error(`extraction failed for ${msg.body.messageId}:`, err);
                    msg.retry();
                  }),
              }),
            ),
          { concurrency: "unbounded" },
        ),
      );
    } finally {
      await runtime.dispose();
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const db = drizzle(env.DB, { schema });
    const now = new Date();

    const activeAccounts = await db.query.emailAccount.findMany({
      where: or(isNull(schema.emailAccount.expiresAt), gt(schema.emailAccount.expiresAt, now)),
    });

    console.log(`[cron] syncing ${activeAccounts.length} active account(s)`);

    const runtime = ManagedRuntime.make(makeServicesLayer(env));
    try {
      await runtime.runPromise(
        Effect.forEach(
          activeAccounts,
          (account) =>
            Effect.gen(function* () {
              const svc = yield* EmailMessageService;
              yield* svc.syncAccountInternal(account);
            }).pipe(
              Effect.catchAll((err) =>
                Effect.sync(() => console.error(`[cron] sync failed for ${account.email}:`, err)),
              ),
            ),
          { concurrency: "unbounded" },
        ),
      );
    } finally {
      await runtime.dispose();
    }
  },
};
