import { defineConfig } from "drizzle-kit";
import fs from "fs";
import path from "path";

function getLocalD1DB() {
  const basePath = path.resolve(".wrangler");
  const dbFile = fs
    .readdirSync(basePath, { encoding: "utf-8", recursive: true })
    .find((f) => f.endsWith(".sqlite") && !f.includes("metadata"));

  if (!dbFile) {
    throw new Error(`.sqlite file not found in ${basePath}. Run wrangler dev first.`);
  }
  return path.resolve(basePath, dbFile);
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  ...(process.env.NODE_ENV === "production"
    ? {
        driver: "d1-http",
        dbCredentials: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
          databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
          token: process.env.CLOUDFLARE_D1_TOKEN!,
        },
      }
    : {
        dbCredentials: {
          url: getLocalD1DB(),
        },
      }),
});
