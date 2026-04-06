import { Context, Effect, Layer, pipe } from "effect";
import { HttpClient, HttpClientRequest } from "@effect/platform";
import { MailTmError } from "../errors";
import { MailTmAccount, MailTmDomain, MailTmMessage, MailTmMessageList } from "../schemas";

const MAIL_TM_API = "https://api.mail.tm";

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

    return {
      getDomains: () =>
        doGet("/domains").pipe(
          Effect.map((res: any) => res["hydra:member"] as ReadonlyArray<typeof MailTmDomain.Type>),
        ),

      createAccount: (address: string, password: string) =>
        doPost("/accounts", { address, password }).pipe(
          Effect.map(
            (res: any) =>
              ({
                id: res.id,
                address: res.address,
              }) as typeof MailTmAccount.Type,
          ),
        ),

      getToken: (address: string, password: string) =>
        doPost("/token", { address, password }).pipe(Effect.map((res: any) => res.token as string)),

      getMessages: (token: string) =>
        doGet("/messages", token).pipe(Effect.map((res) => res as typeof MailTmMessageList.Type)),

      getMessage: (token: string, messageId: string) =>
        doGet(`/messages/${messageId}`, token).pipe(
          Effect.map((res) => res as typeof MailTmMessage.Type),
        ),
    };
  }),
);
