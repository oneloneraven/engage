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

test("only the default and production configs bind outbound email, so previews and e2e never send", () => {
  const expected = [{ name: "EMAIL" }];
  expect(wrangler.send_email).toEqual(expected);
  expect(wrangler.env.production.send_email).toEqual(expected);
  expect(wrangler.env.preview.send_email).toBeUndefined();
  expect(wrangler.env.preview.previews.send_email).toBeUndefined();
  expect(wrangler.env.e2e.send_email).toBeUndefined();
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
