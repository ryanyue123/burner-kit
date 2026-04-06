import { Data } from "effect";

export class MailTmError extends Data.TaggedError("MailTmError")<{
  readonly reason: string;
}> {}

export class EmailAccountNotFoundError extends Data.TaggedError("EmailAccountNotFoundError")<{
  readonly accountId: string;
}> {}

export class EmailMessageNotFoundError extends Data.TaggedError("EmailMessageNotFoundError")<{
  readonly messageId: string;
}> {}
