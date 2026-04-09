import { FetchHttpClient, HttpApiBuilder, HttpServer } from "@effect/platform";
import { drizzle } from "drizzle-orm/d1";
import { Layer } from "effect";
import * as schema from "./db/schema";
import { BurnerKitApi } from "./api";
import { createAuth } from "./auth";
import { HandlersLive } from "./handlers";
import { makeAuthMiddlewareLive, type AppBindings } from "./middleware";
import { Db } from "./services/db";
import { EmailAccountServiceLive } from "./services/email-account";
import { EmailMessageServiceLive } from "./services/email-message";
import { MailTmLive } from "./services/mail-tm";

export type { AppBindings };

export function makeAppLayer(env: AppBindings) {
  const db = drizzle(env.DB, { schema });
  const auth = createAuth(env);

  const dbLayer = Layer.succeed(Db, db);
  const mailTmLayer = MailTmLive.pipe(Layer.provide(FetchHttpClient.layer));

  const emailAccountLayer = EmailAccountServiceLive.pipe(
    Layer.provide(dbLayer),
    Layer.provide(mailTmLayer),
  );

  const emailMessageLayer = EmailMessageServiceLive.pipe(
    Layer.provide(dbLayer),
    Layer.provide(emailAccountLayer),
    Layer.provide(mailTmLayer),
  );

  const authLayer = makeAuthMiddlewareLive(auth);

  const servicesLayer = Layer.mergeAll(emailAccountLayer, emailMessageLayer, authLayer);

  const apiLayer = HttpApiBuilder.api(BurnerKitApi).pipe(
    Layer.provide(HandlersLive),
    Layer.provide(servicesLayer),
  );

  return Layer.mergeAll(apiLayer, HttpServer.layerContext);
}
