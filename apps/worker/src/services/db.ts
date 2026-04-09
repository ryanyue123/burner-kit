import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Context, Effect } from "effect";
import { DatabaseError } from "../errors";
import type * as schema from "../db/schema";

export class Db extends Context.Tag("Db")<Db, DrizzleD1Database<typeof schema>>() {}

export const query = <A>(execute: () => Promise<A>) =>
  Effect.tryPromise({
    try: execute,
    catch: (cause) => new DatabaseError({ message: String(cause) }),
  });
