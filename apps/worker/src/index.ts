import { HttpApiBuilder } from "@effect/platform";
import { createAuth } from "./auth";
import { makeAppLayer } from "./runtime";
import type { AppBindings } from "./middleware";

function corsHeaders(env: AppBindings) {
  return {
    "Access-Control-Allow-Origin": env.EXTENSION_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "600",
  };
}

export default {
  async fetch(request: Request, env: AppBindings): Promise<Response> {
    const cors = corsHeaders(env);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // Better Auth routes — served by Better Auth directly
    if (url.pathname.startsWith("/api/auth/")) {
      const auth = createAuth(env);
      const res = await auth.handler(request);
      for (const [k, v] of Object.entries(cors)) {
        res.headers.set(k, v);
      }
      return res;
    }

    // All other routes — Effect HttpApi
    const { handler } = HttpApiBuilder.toWebHandler(makeAppLayer(env));
    const res = await handler(request);

    for (const [k, v] of Object.entries(cors)) {
      res.headers.set(k, v);
    }
    return res;
  },
};
