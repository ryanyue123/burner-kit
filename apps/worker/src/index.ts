import { Hono } from "hono";
import { cors } from "hono/cors";
import { attachAuth, requireUser, type AppBindings, type AppVariables } from "./middleware";

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

app.use("*", (c, next) =>
  cors({
    origin: c.env.EXTENSION_ORIGIN ?? "*",
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  })(c, next),
);

app.use("*", attachAuth);

// Better Auth handler — must come before our app routes so its own
// /api/auth/* routes are served by Better Auth directly.
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = c.get("auth");
  return auth.handler(c.req.raw);
});

// Public health check
app.get("/", (c) => c.json({ ok: true, service: "burner-kit-worker" }));

// Protected: returns the current anonymous user
app.get("/api/me", requireUser, (c) => {
  const user = c.get("user")!;
  return c.json({
    userId: user.id,
    createdAt: user.createdAt,
    isAnonymous: user.isAnonymous ?? false,
  });
});

export default app;
