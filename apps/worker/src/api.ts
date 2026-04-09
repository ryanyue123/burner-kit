import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { AuthMiddleware } from "./middleware";
import {
  DatabaseError,
  EmailAccountNotFoundError,
  EmailMessageNotFoundError,
  MailTmError,
} from "./errors";

// ── Response schemas ──────────────────────────────────────────

export const AccountResponse = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  domain: Schema.String,
  label: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  expiresAt: Schema.NullOr(Schema.Number),
  unreadCount: Schema.optional(Schema.Number),
});

export const MessageResponse = Schema.Struct({
  id: Schema.String,
  emailAccountId: Schema.String,
  fromAddress: Schema.String,
  subject: Schema.NullOr(Schema.String),
  textContent: Schema.NullOr(Schema.String),
  htmlContent: Schema.NullOr(Schema.String),
  receivedAt: Schema.Number,
  isRead: Schema.Boolean,
});

export const MeResponse = Schema.Struct({
  userId: Schema.String,
  createdAt: Schema.Number,
  isAnonymous: Schema.Boolean,
});

export const HealthResponse = Schema.Struct({
  ok: Schema.Boolean,
  service: Schema.String,
});

// ── Request schemas ───────────────────────────────────────────

const AccountId = HttpApiSchema.param("id", Schema.String);
const MessageId = HttpApiSchema.param("msgId", Schema.String);

export const UpdateAccountBody = Schema.Struct({
  label: Schema.optional(Schema.NullOr(Schema.String)),
  expiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const MarkReadBody = Schema.Struct({
  isRead: Schema.Boolean,
});

// ── Endpoint groups ───────────────────────────────────────────

export class EmailAccountsGroup extends HttpApiGroup.make("emailAccounts")
  .add(
    HttpApiEndpoint.post("create", "/")
      .addSuccess(AccountResponse, { status: 201 })
      .addError(MailTmError)
      .addError(DatabaseError),
  )
  .add(
    HttpApiEndpoint.get("list", "/")
      .addSuccess(Schema.Array(AccountResponse))
      .addError(DatabaseError),
  )
  .add(
    HttpApiEndpoint.del("remove")`/${AccountId}`
      .addError(EmailAccountNotFoundError)
      .addError(DatabaseError),
  )
  .add(
    HttpApiEndpoint.patch("update")`/${AccountId}`
      .setPayload(UpdateAccountBody)
      .addSuccess(AccountResponse)
      .addError(EmailAccountNotFoundError)
      .addError(DatabaseError),
  )
  .add(
    HttpApiEndpoint.get("listMessages")`/${AccountId}/messages`
      .addSuccess(Schema.Array(MessageResponse))
      .addError(EmailAccountNotFoundError)
      .addError(DatabaseError),
  )
  .add(
    HttpApiEndpoint.get("getMessage")`/${AccountId}/messages/${MessageId}`
      .addSuccess(MessageResponse)
      .addError(EmailAccountNotFoundError)
      .addError(EmailMessageNotFoundError)
      .addError(DatabaseError),
  )
  .add(
    HttpApiEndpoint.patch("markRead")`/${AccountId}/messages/${MessageId}`
      .setPayload(MarkReadBody)
      .addSuccess(MessageResponse)
      .addError(EmailAccountNotFoundError)
      .addError(EmailMessageNotFoundError)
      .addError(DatabaseError),
  )
  .prefix("/api/email-accounts")
  .middleware(AuthMiddleware) {}

export class MiscGroup extends HttpApiGroup.make("misc", { topLevel: true })
  .add(HttpApiEndpoint.get("health", "/").addSuccess(HealthResponse))
  .add(HttpApiEndpoint.get("me", "/api/me").addSuccess(MeResponse).middleware(AuthMiddleware)) {}

export class BurnerKitApi extends HttpApi.make("burnerKit")
  .add(EmailAccountsGroup)
  .add(MiscGroup) {}
