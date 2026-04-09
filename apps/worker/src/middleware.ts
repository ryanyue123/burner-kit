import { Context, Effect, Layer } from "effect";
import { HttpApiMiddleware, HttpServerRequest } from "@effect/platform";
import { type Auth } from "./auth";
import { UnauthorizedError } from "./errors";

export type AppBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  EXTENSION_ORIGIN?: string;
};

export type AuthUser = {
  id: string;
  createdAt: Date;
  isAnonymous?: boolean;
};

export class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, AuthUser>() {}

export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()("AuthMiddleware", {
  failure: UnauthorizedError,
  provides: CurrentUser,
}) {}

export const makeAuthMiddlewareLive = (auth: Auth) =>
  Layer.succeed(
    AuthMiddleware,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const headers = request.headers;
      const session = yield* Effect.tryPromise({
        try: () => auth.api.getSession({ headers: new Headers(headers) }),
        catch: () => new UnauthorizedError(),
      });
      if (!session?.user) {
        return yield* Effect.fail(new UnauthorizedError());
      }
      const user = session.user as { id: string; createdAt: string | Date; isAnonymous?: boolean };
      return {
        id: user.id,
        createdAt: user.createdAt instanceof Date ? user.createdAt : new Date(user.createdAt),
        isAnonymous: user.isAnonymous ?? false,
      };
    }),
  );
