import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Context, Effect } from "effect";
import { DatabaseError } from "../errors";
import type * as schema from "../db/schema";

export class Db extends Context.Tag("Db")<Db, DrizzleD1Database<typeof schema>>() {}

export const query = <A>(execute: () => Promise<A>, label = "db query") =>
  Effect.tryPromise(execute).pipe(
    Effect.tapErrorCause((cause) => Effect.logError(`${label} failed`, cause)),
    Effect.mapError((err) => new DatabaseError({ message: `${label} failed: ${err}` })),
  );
