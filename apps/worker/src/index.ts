import { Hono } from "hono";

type Bindings = {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => c.json({ ok: true, service: "burner-kit-worker" }));

export default app;
