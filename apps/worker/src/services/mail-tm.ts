import { Context, Effect, Layer, Schema, pipe } from "effect";
import { HttpClient, HttpClientRequest } from "@effect/platform";
import { MailTmError } from "../errors";
import { MailTmAccount, MailTmDomain, MailTmMessage, MailTmMessageList } from "../schemas";

const MAIL_TM_API = "https://api.mail.tm";

const MailTmDomainResponse = Schema.Struct({
  "hydra:member": Schema.Array(MailTmDomain),
});

export class MailTm extends Context.Tag("MailTm")<
  MailTm,
  {
    readonly getDomains: () => Effect.Effect<ReadonlyArray<typeof MailTmDomain.Type>, MailTmError>;
    readonly createAccount: (
      address: string,
      password: string,
    ) => Effect.Effect<typeof MailTmAccount.Type, MailTmError>;
    readonly getToken: (address: string, password: string) => Effect.Effect<string, MailTmError>;
    readonly getMessages: (
      token: string,
    ) => Effect.Effect<typeof MailTmMessageList.Type, MailTmError>;
    readonly getMessage: (
      token: string,
      messageId: string,
    ) => Effect.Effect<typeof MailTmMessage.Type, MailTmError>;
  }
>() {}

export const MailTmLive = Layer.effect(
  MailTm,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const doGet = (path: string, token?: string) =>
      pipe(
        HttpClientRequest.get(`${MAIL_TM_API}${path}`),
        token ? HttpClientRequest.bearerToken(token) : (req) => req,
        (req) =>
          client.execute(req).pipe(
            Effect.flatMap((res) => res.json),
            Effect.catchAll((e) =>
              Effect.fail(
                new MailTmError({
                  reason: `mail.tm GET ${path} failed: ${e}`,
                }),
              ),
            ),
          ),
      );

    const doPost = (path: string, body: unknown) =>
      pipe(
        HttpClientRequest.post(`${MAIL_TM_API}${path}`),
        HttpClientRequest.bodyJson(body),
        Effect.flatMap((req) => client.execute(req).pipe(Effect.flatMap((res) => res.json))),
        Effect.catchAll((e) =>
          Effect.fail(
            new MailTmError({
              reason: `mail.tm POST ${path} failed: ${e}`,
            }),
          ),
        ),
      );

    const decode =
      <A, I>(schema: Schema.Schema<A, I>) =>
      (data: unknown) =>
        Schema.decodeUnknown(schema)(data).pipe(
          Effect.catchAll((e) =>
            Effect.fail(new MailTmError({ reason: `mail.tm decode failed: ${e}` })),
          ),
        );

    return {
      getDomains: () =>
        doGet("/domains").pipe(
          Effect.flatMap(decode(MailTmDomainResponse)),
          Effect.map((res) => res["hydra:member"]),
        ),

      createAccount: (address: string, password: string) =>
        doPost("/accounts", { address, password }).pipe(Effect.flatMap(decode(MailTmAccount))),

      getToken: (address: string, password: string) =>
        doPost("/token", { address, password }).pipe(
          Effect.flatMap(decode(Schema.Struct({ token: Schema.String }))),
          Effect.map((res) => res.token),
        ),

      getMessages: (token: string) =>
        doGet("/messages", token).pipe(Effect.flatMap(decode(MailTmMessageList))),

      getMessage: (token: string, messageId: string) =>
        doGet(`/messages/${messageId}`, token).pipe(Effect.flatMap(decode(MailTmMessage))),
    };
  }),
);
