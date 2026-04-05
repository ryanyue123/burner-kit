import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "d1-http",
  // For local dev we'll use `wrangler d1 migrations apply` directly,
  // so driver config below is only used if you later run `drizzle-kit push` against prod.
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_TOKEN ?? "",
  },
} satisfies Config;
