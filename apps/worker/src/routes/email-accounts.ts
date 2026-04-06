import { Hono } from "hono";
import { Effect } from "effect";
import type { AppBindings, AppVariables } from "../middleware";
import { requireUser } from "../middleware";
import { EmailAccountService } from "../services/email-account";
import { EmailMessageService } from "../services/email-message";
import { makeAppRuntime } from "../runtime";
import { EmailAccountNotFoundError, EmailMessageNotFoundError, MailTmError } from "../errors";

type Env = { Bindings: AppBindings; Variables: AppVariables };

const emailAccounts = new Hono<Env>();

function runEffect<A>(
  env: AppBindings,
  effect: Effect.Effect<
    A,
    MailTmError | EmailAccountNotFoundError | EmailMessageNotFoundError,
    EmailAccountService | EmailMessageService
  >,
) {
  const runtime = makeAppRuntime(env);
  return Effect.runPromise(
    effect.pipe(
      Effect.catchTags({
        MailTmError: (e) =>
          Effect.succeed({
            _tag: "error" as const,
            code: "MAIL_TM_ERROR" as const,
            message: e.reason,
          }),
        EmailAccountNotFoundError: (e) =>
          Effect.succeed({
            _tag: "error" as const,
            code: "NOT_FOUND" as const,
            message: `Account ${e.accountId} not found`,
          }),
        EmailMessageNotFoundError: (e) =>
          Effect.succeed({
            _tag: "error" as const,
            code: "NOT_FOUND" as const,
            message: `Message ${e.messageId} not found`,
          }),
      }),
      Effect.provide(runtime),
    ),
  ).then((result) => {
    if (result && typeof result === "object" && "_tag" in result && result._tag === "error") {
      return { ok: false as const, error: result };
    }
    return { ok: true as const, data: result };
  });
}

// POST /api/email-accounts -- generate a new burner email
emailAccounts.post("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const result = await runEffect(
    c.env,
    EmailAccountService.pipe(Effect.flatMap((svc) => svc.create(user.id))),
  );
  if (!result.ok) return c.json(result, 500);
  const {
    providerToken: _pt,
    providerAccountId: _pa,
    ...safe
  } = result.data as Record<string, unknown>;
  return c.json({ ok: true, data: safe }, 201);
});

// GET /api/email-accounts -- list user's accounts
emailAccounts.get("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const result = await runEffect(
    c.env,
    EmailAccountService.pipe(Effect.flatMap((svc) => svc.list(user.id))),
  );
  return c.json(result);
});

// DELETE /api/email-accounts/:id
emailAccounts.delete("/:id", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id")!;
  const result = await runEffect(
    c.env,
    EmailAccountService.pipe(Effect.flatMap((svc) => svc.remove(user.id, id))),
  );
  if (!result.ok) return c.json(result, 404);
  return c.json({ ok: true });
});

// PATCH /api/email-accounts/:id
emailAccounts.patch("/:id", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id")!;
  const body = await c.req.json<{
    label?: string | null;
    expiresAt?: number | null;
  }>();
  const result = await runEffect(
    c.env,
    EmailAccountService.pipe(
      Effect.flatMap((svc) =>
        svc.update(user.id, id, {
          label: body.label,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        }),
      ),
    ),
  );
  if (!result.ok) return c.json(result, 404);
  const {
    providerToken: _pt2,
    providerAccountId: _pa2,
    ...safe
  } = result.data as Record<string, unknown>;
  return c.json({ ok: true, data: safe });
});

// GET /api/email-accounts/:id/messages -- sync + list
emailAccounts.get("/:id/messages", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id")!;
  const result = await runEffect(
    c.env,
    EmailMessageService.pipe(Effect.flatMap((svc) => svc.syncAndList(user.id, id))),
  );
  if (!result.ok) return c.json(result, 404);
  return c.json(result);
});

// GET /api/email-accounts/:id/messages/:msgId
emailAccounts.get("/:id/messages/:msgId", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id")!;
  const msgId = c.req.param("msgId")!;
  const result = await runEffect(
    c.env,
    EmailMessageService.pipe(Effect.flatMap((svc) => svc.get(user.id, id, msgId))),
  );
  if (!result.ok) return c.json(result, 404);
  return c.json(result);
});

// PATCH /api/email-accounts/:id/messages/:msgId -- mark read/unread
emailAccounts.patch("/:id/messages/:msgId", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id")!;
  const msgId = c.req.param("msgId")!;
  const body = await c.req.json<{ isRead: boolean }>();
  const result = await runEffect(
    c.env,
    EmailMessageService.pipe(
      Effect.flatMap((svc) => svc.markRead(user.id, id, msgId, body.isRead)),
    ),
  );
  if (!result.ok) return c.json(result, 404);
  return c.json(result);
});

export default emailAccounts;
