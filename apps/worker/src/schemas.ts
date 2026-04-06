import { Schema as S } from "effect";

export class MailTmDomain extends S.Class<MailTmDomain>("MailTmDomain")({
  id: S.String,
  domain: S.String,
  isActive: S.Boolean,
}) {}

export class MailTmAccount extends S.Class<MailTmAccount>("MailTmAccount")({
  id: S.String,
  address: S.String,
}) {}

export class MailTmToken extends S.Class<MailTmToken>("MailTmToken")({
  token: S.String,
}) {}

export class MailTmMessage extends S.Class<MailTmMessage>("MailTmMessage")({
  id: S.String,
  from: S.Struct({
    address: S.String,
    name: S.optional(S.String),
  }),
  subject: S.optional(S.String),
  text: S.optional(S.String),
  html: S.optional(S.NullishOr(S.Array(S.String))),
  createdAt: S.String,
  seen: S.Boolean,
}) {}

export class MailTmMessageList extends S.Class<MailTmMessageList>("MailTmMessageList")({
  "hydra:member": S.Array(MailTmMessage),
}) {}

export class EmailAccountResponse extends S.Class<EmailAccountResponse>("EmailAccountResponse")({
  id: S.String,
  email: S.String,
  domain: S.String,
  label: S.NullOr(S.String),
  createdAt: S.Number,
  expiresAt: S.NullOr(S.Number),
  unreadCount: S.optional(S.Number),
}) {}

export class EmailMessageResponse extends S.Class<EmailMessageResponse>("EmailMessageResponse")({
  id: S.String,
  emailAccountId: S.String,
  fromAddress: S.String,
  subject: S.NullOr(S.String),
  textContent: S.NullOr(S.String),
  htmlContent: S.NullOr(S.String),
  receivedAt: S.Number,
  isRead: S.Boolean,
}) {}
