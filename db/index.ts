import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  const runtime = env as unknown as { DB?: D1Database };
  if (!runtime.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure it in wrangler.jsonc before using the database."
    );
  }

  return drizzle(runtime.DB, { schema });
}
