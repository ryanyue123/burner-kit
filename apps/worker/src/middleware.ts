import type { Context, Next } from "hono";
import { createAuth, type Auth } from "./auth";

type AuthUser = {
  id: string;
  createdAt: Date;
  isAnonymous?: boolean;
};

type AuthSession = {
  id: string;
  userId: string;
  expiresAt: Date;
};

export type AppBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  EXTENSION_ORIGIN?: string;
};

export type AppVariables = {
  user: AuthUser | null;
  session: AuthSession | null;
  auth: Auth;
};

export async function attachAuth(
  c: Context<{ Bindings: AppBindings; Variables: AppVariables }>,
  next: Next,
) {
  const auth = createAuth(c.env);
  c.set("auth", auth);

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", (session?.user as AuthUser | undefined) ?? null);
  c.set("session", (session?.session as AuthSession | undefined) ?? null);

  await next();
}

export async function requireUser(
  c: Context<{ Bindings: AppBindings; Variables: AppVariables }>,
  next: Next,
) {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}
