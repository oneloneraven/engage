import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);
await env.DB.exec(env.SEED_PRODUCTS_SQL.replace(/\s*\n\s*/g, " "));
