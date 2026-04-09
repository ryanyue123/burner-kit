import { Schema } from "effect";
import { HttpApiSchema } from "@effect/platform";

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {},
  HttpApiSchema.annotations({ status: 401 }),
) {}

export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 500 }),
) {}

export class MailTmError extends Schema.TaggedError<MailTmError>()(
  "MailTmError",
  { reason: Schema.String },
  HttpApiSchema.annotations({ status: 502 }),
) {}

export class EmailAccountNotFoundError extends Schema.TaggedError<EmailAccountNotFoundError>()(
  "EmailAccountNotFoundError",
  { accountId: Schema.String },
  HttpApiSchema.annotations({ status: 404 }),
) {}

export class EmailMessageNotFoundError extends Schema.TaggedError<EmailMessageNotFoundError>()(
  "EmailMessageNotFoundError",
  { messageId: Schema.String },
  HttpApiSchema.annotations({ status: 404 }),
) {}
