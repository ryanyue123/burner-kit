import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "@effect/platform";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { MailTmLive } from "./services/mail-tm";
import { makeEmailAccountService } from "./services/email-account";
import { makeEmailMessageService } from "./services/email-message";
import type { AppBindings } from "./middleware";

export function makeAppRuntime(env: AppBindings) {
  const db = drizzle(env.DB, { schema });

  const mailTmLayer = MailTmLive.pipe(Layer.provide(FetchHttpClient.layer));

  const emailAccountLayer = makeEmailAccountService(db).pipe(
    Layer.provide(mailTmLayer),
  );

  const emailMessageLayer = makeEmailMessageService(db).pipe(
    Layer.provide(emailAccountLayer),
    Layer.provide(mailTmLayer),
  );

  const appLayer = Layer.mergeAll(emailAccountLayer, emailMessageLayer);

  return ManagedRuntime.make(appLayer);
}

export type AppRuntime = ReturnType<typeof makeAppRuntime>;
