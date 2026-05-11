import { FetchHttpClient, HttpApiBuilder, HttpServer } from "@effect/platform";
import { drizzle } from "drizzle-orm/d1";
import { Layer } from "effect";
import * as schema from "./db/schema";
import { BurnerKitApi } from "./api";
import { createAuth } from "./auth";
import { HandlersLive } from "./handlers";
import { makeAuthMiddlewareLive } from "./middleware";
import { Db } from "./services/db";
import { EmailAccountServiceLive } from "./services/email-account";
import { EmailMessageServiceLive } from "./services/email-message";
import { ExtractionServiceLive, CodeQueue, WorkersAi } from "./services/extraction";
import { MailTmLive } from "./services/mail-tm";

export function makeServicesLayer(env: Env) {
  const db = drizzle(env.DB, { schema });
  const auth = createAuth(env);

  const dbLayer = Layer.succeed(Db, db);
  const codeQueueLayer = Layer.succeed(CodeQueue, env.CODE_EXTRACTION_QUEUE);
  const aiLayer = Layer.succeed(WorkersAi, env.AI);
  const mailTmLayer = MailTmLive.pipe(Layer.provide(FetchHttpClient.layer));

  const emailAccountLayer = EmailAccountServiceLive.pipe(
    Layer.provide(dbLayer),
    Layer.provide(mailTmLayer),
  );

  const emailMessageLayer = EmailMessageServiceLive.pipe(
    Layer.provide(dbLayer),
    Layer.provide(emailAccountLayer),
    Layer.provide(mailTmLayer),
    Layer.provide(codeQueueLayer),
  );

  const extractionLayer = ExtractionServiceLive.pipe(
    Layer.provide(dbLayer),
    Layer.provide(aiLayer),
  );

  const authLayer = makeAuthMiddlewareLive(auth);

  return Layer.mergeAll(dbLayer, emailAccountLayer, emailMessageLayer, extractionLayer, authLayer);
}

export function makeApiLayer(env: Env) {
  const services = makeServicesLayer(env);
  const apiLayer = HttpApiBuilder.api(BurnerKitApi).pipe(
    Layer.provide(HandlersLive),
    Layer.provide(services),
  );
  return Layer.mergeAll(apiLayer, HttpServer.layerContext);
}
