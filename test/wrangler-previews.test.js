import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const wrangler = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));

test("PR previews repeat the preview environment's vars, since they inherit nothing", () => {
  const { previews, vars } = wrangler.env.preview;
  expect(previews.vars).toEqual(vars);
});

test("every environment, and PR previews, repeat the D1 binding", () => {
  const expected = wrangler.d1_databases;
  expect(expected).toHaveLength(1);
  expect(expected[0]).toMatchObject({ binding: "DB", database_name: "engage", migrations_dir: "migrations" });
  for (const [name, environment] of Object.entries(wrangler.env)) {
    expect(environment.d1_databases, name).toEqual(expected);
  }
  expect(wrangler.env.preview.previews.d1_databases).toEqual(expected);
});

test("every environment, and PR previews, repeat both intake rate limiters with their own namespaces", () => {
  const expected = [
    { name: "INTAKE_WEB_LIMITER", simple: { limit: 5, period: 60 } },
    { name: "INTAKE_APP_LIMITER", simple: { limit: 3, period: 60 } },
  ];
  const configs = {
    default: wrangler,
    ...wrangler.env,
    "preview.previews": wrangler.env.preview.previews,
  };
  const namespaces = [];
  for (const [name, config] of Object.entries(configs)) {
    expect(
      config.ratelimits.map(({ name: binding, simple }) => ({ name: binding, simple })),
      name,
    ).toEqual(expected);
    namespaces.push(...config.ratelimits.map(limiter => limiter.namespace_id));
  }
  expect(new Set(namespaces).size).toBe(namespaces.length);
  for (const id of namespaces) expect(Number(id)).toBeGreaterThanOrEqual(3001);
});

test("previews never bind outbound email, and e2e binds it only for local simulation, so neither sends", () => {
  const expected = [{ name: "EMAIL" }];
  expect(wrangler.send_email).toEqual(expected);
  expect(wrangler.env.production.send_email).toEqual(expected);
  expect(wrangler.env.preview.send_email).toBeUndefined();
  expect(wrangler.env.preview.previews.send_email).toBeUndefined();
  expect(wrangler.env.e2e.send_email).toEqual(expected);
  expect(wrangler.env.e2e.routes).toBeUndefined();
  expect(wrangler.env.e2e.workers_dev ?? wrangler.workers_dev).toBe(false);
});

test("only e2e sets a reply-address secret in config; every real environment takes it as a Worker secret", () => {
  expect(wrangler.env.e2e.vars.REPLY_ADDRESS_SECRET).toBe("e2e-only-not-a-secret");
  for (const config of [wrangler, wrangler.env.production, wrangler.env.preview, wrangler.env.preview.previews]) {
    expect(config.vars.REPLY_ADDRESS_SECRET).toBeUndefined();
  }
});

test("only the default and production configs bind the attachments bucket, so previews and e2e never write to it", () => {
  const expected = [{ binding: "ATTACHMENTS", bucket_name: "engage-attachments" }];
  expect(wrangler.r2_buckets).toEqual(expected);
  expect(wrangler.env.production.r2_buckets).toEqual(expected);
  expect(wrangler.env.preview.r2_buckets).toBeUndefined();
  expect(wrangler.env.preview.previews.r2_buckets).toBeUndefined();
  expect(wrangler.env.e2e.r2_buckets).toBeUndefined();
});

test("only production runs the retention cron, so previews, PR previews and e2e never delete anything", () => {
  expect(wrangler.env.production.triggers).toEqual({ crons: ["17 3 * * *"] });
  expect(wrangler.env.preview.triggers).toBeUndefined();
  expect(wrangler.env.preview.previews.triggers).toBeUndefined();
  expect(wrangler.env.e2e.triggers).toBeUndefined();
});

test("production names its Access team domain and audience, so the admin host can let the owner in", () => {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD } = wrangler.env.production.vars;
  expect(ACCESS_TEAM_DOMAIN).toMatch(/^[a-z0-9-]+\.cloudflareaccess\.com$/);
  expect(ACCESS_AUD).toMatch(/^[0-9a-f]{64}$/);
});

test("every environment runs the Worker before its assets, so the admin shell is behind the Access check and only on the admin host", () => {
  const configs = { default: wrangler, ...wrangler.env };
  for (const [name, config] of Object.entries(configs)) {
    expect(config.assets, name).toEqual({
      directory: "./dist",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: true,
    });
  }
});
