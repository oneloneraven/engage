import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readClimbs } from "../src/products/climbing-logbook.js";
import worker from "../src/worker.js";
import { makeCtx, makeEnv } from "./helpers.js";

const USAGE_URL = "https://admin.climbinglogbook.test/-/api/admin/usage";
const ENGAGEMENT = [
  { source: "cl-usage", metric: "active-users", label: "Active climbers", url: USAGE_URL, field: "activeUsers" },
];
const TOKENS = { CL_USAGE_CLIENT_ID: "client-id", CL_USAGE_CLIENT_SECRET: "client-secret" };

/** @param {Record<string, unknown>} [overrides] */
const testEnv = (overrides = {}) => makeEnv({ ...TOKENS, ...overrides });

/** @param {unknown} body @param {number} [status] */
function stubUsage(body, status = 200) {
  /** @type {{ url: string, init: RequestInit | undefined }[]} */
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(body, { status });
  });
  return calls;
}

/** @param {string} path */
async function call(path) {
  const env = testEnv({
    APP_ENV: "e2e",
    ADMIN_HOST: "localhost",
    ADMIN_ACCESS_CHECK: "off",
    ASSETS: { fetch: async () => new Response("asset") },
  });
  const ctx = makeCtx();
  const response = await worker.fetch(new Request(`https://localhost${path}`), env, ctx);
  await ctx.settled();
  return response;
}

beforeEach(async () => {
  await baseEnv.DB.prepare("UPDATE products SET engagement = ? WHERE slug = 'cl'")
    .bind(JSON.stringify(ENGAGEMENT))
    .run();
});
afterEach(() => vi.restoreAllMocks());

test("climbs come back by status and discipline, largest first, with nothing else the endpoint sends", async () => {
  const calls = stubUsage({
    climbs: 120,
    activeUsers: 9,
    statuses: { project: 20, send: 70, flash: 30 },
    disciplines: { sport: 45, boulder: 75 },
    countries: [{ country: "France", locations: [{ location: "Someone's crag" }] }],
  });
  expect(await readClimbs(testEnv())).toEqual({
    setUp: true,
    climbs: 120,
    statuses: [
      { key: "send", climbs: 70 },
      { key: "flash", climbs: 30 },
      { key: "project", climbs: 20 },
    ],
    disciplines: [
      { key: "boulder", climbs: 75 },
      { key: "sport", climbs: 45 },
    ],
  });
  expect(calls[0].url).toBe(USAGE_URL);
  expect(new Headers(calls[0].init?.headers).get("CF-Access-Client-Id")).toBe("client-id");
  expect(calls[0].init?.redirect).toBe("manual");
});

test("counts that aren't whole and non-negative, and keys that aren't plain, are dropped", async () => {
  stubUsage({
    statuses: { send: 3, project: -1, checkout: 2.5, "<b>x</b>": 4, archived: "7" },
    disciplines: ["boulder"],
  });
  expect(await readClimbs(testEnv())).toEqual({
    setUp: true,
    climbs: 3,
    statuses: [{ key: "send", climbs: 3 }],
    disciplines: [],
  });
});

test("without the service token or a usage source, it isn't set up and nothing is fetched", async () => {
  const calls = stubUsage({});
  expect(await readClimbs(testEnv({ CL_USAGE_CLIENT_SECRET: undefined }))).toEqual({ setUp: false });
  await baseEnv.DB.exec("UPDATE products SET engagement = '[]' WHERE slug = 'cl'");
  expect(await readClimbs(testEnv())).toEqual({ setUp: false });
  await baseEnv.DB.prepare("UPDATE products SET engagement = ? WHERE slug = 'cl'")
    .bind(JSON.stringify([{ ...ENGAGEMENT[0], url: "http://plain.example/usage" }]))
    .run();
  expect(await readClimbs(testEnv())).toEqual({ setUp: false });
  expect(calls).toEqual([]);
});

test("the endpoint failing or redirecting is unavailable, never an empty breakdown", async () => {
  stubUsage({ error: "nope" }, 503);
  await expect(readClimbs(testEnv())).rejects.toThrow("product-unavailable");
  stubUsage({}, 302);
  await expect(readClimbs(testEnv())).rejects.toThrow("product-unavailable");
});

test("the API serves a product's own page by route, and 502s when the product can't be read", async () => {
  stubUsage({ climbs: 1, statuses: { send: 1 }, disciplines: { sport: 1 } });
  const response = await call("/api/products/climbing-logbook/climbs");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ setUp: true, climbs: 1 });
  stubUsage({}, 500);
  expect((await call("/api/products/climbing-logbook/climbs")).status).toBe(502);
});

test("a page a product doesn't have, or a slug in place of a route, is not found", async () => {
  const calls = stubUsage({});
  for (const path of [
    "/api/products/deaftly/climbs",
    "/api/products/climbing-logbook/constructor",
    "/api/products/cl/climbs",
    "/api/products/nope/climbs",
  ])
    expect((await call(path)).status, path).toBe(404);
  expect(calls).toEqual([]);
});
