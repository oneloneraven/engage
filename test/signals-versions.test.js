import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { refreshVersions } from "../src/signals/versions.js";
import worker from "../src/worker.js";
import { makeCtx, makeEnv } from "./helpers.js";

const EARLIER = new Date("2026-11-20T09:00:00.000Z");
const NOW = new Date("2026-11-25T12:05:00.000Z");
const PROD = "https://my.climbinglogbook.example/-/api/health/ready";
const BETA = "https://beta.climbinglogbook.example/-/api/health/ready";

/**
 * @param {Record<string, () => Response | Promise<Response>>} answers by URL
 */
function stubProbes(answers) {
  /** @type {string[]} */
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const answer = answers[url];
    return answer ? answer() : new Response("unexpected", { status: 599 });
  });
  return calls;
}

const version = (/** @type {unknown} */ value) => () => Response.json({ ok: true, version: value });

/** @param {unknown} environments */
async function configure(slug, environments) {
  await baseEnv.DB.prepare("UPDATE products SET environments = ? WHERE slug = ?")
    .bind(JSON.stringify(environments), slug)
    .run();
}

/** @param {string} environment */
const rowOf = environment =>
  baseEnv.DB.prepare(
    "SELECT version, first_seen, last_seen FROM deployed_versions WHERE product = 'cl' AND environment = ?",
  )
    .bind(environment)
    .first();

beforeEach(async () => {
  await baseEnv.DB.exec("DELETE FROM deployed_versions");
  await baseEnv.DB.exec("UPDATE products SET environments = '[]'");
  await configure("cl", [
    { name: "production", healthUrl: PROD },
    { name: "beta", healthUrl: BETA },
  ]);
});
afterEach(() => vi.restoreAllMocks());

test("a new version records when it was first seen", async () => {
  stubProbes({ [PROD]: version("v1.14.0"), [BETA]: version("v1.15.0") });
  await refreshVersions(makeEnv(), NOW);
  const now = NOW.toISOString();
  expect(await rowOf("production")).toEqual({ version: "v1.14.0", first_seen: now, last_seen: now });
  expect(await rowOf("beta")).toEqual({ version: "v1.15.0", first_seen: now, last_seen: now });
});

test("the same version again only moves last seen", async () => {
  stubProbes({ [PROD]: version("v1.14.0"), [BETA]: version("v1.15.0") });
  await refreshVersions(makeEnv(), EARLIER);
  await refreshVersions(makeEnv(), NOW);
  expect(await rowOf("beta")).toEqual({
    version: "v1.15.0",
    first_seen: EARLIER.toISOString(),
    last_seen: NOW.toISOString(),
  });
});

test("a different version resets first seen", async () => {
  stubProbes({ [PROD]: version("v1.14.0"), [BETA]: version("v1.15.0") });
  await refreshVersions(makeEnv(), EARLIER);
  stubProbes({ [PROD]: version("v1.14.0"), [BETA]: version("v1.16.0") });
  await refreshVersions(makeEnv(), NOW);
  expect(await rowOf("beta")).toEqual({
    version: "v1.16.0",
    first_seen: NOW.toISOString(),
    last_seen: NOW.toISOString(),
  });
});

test.each([
  ["a 503", () => Response.json({ ok: false, check: "d1" }, { status: 503 })],
  ["no version", () => Response.json({ ok: true })],
  ["a numeric version", version(115)],
  ["a version over 64 characters", version("v".repeat(65))],
  ["a version with markup", version("<b>v1</b>")],
  ["a body that isn't JSON", () => new Response("<html>")],
  [
    "a network error",
    () => {
      throw new TypeError("network down");
    },
  ],
])("a probe with %s leaves the row untouched", async (_, answer) => {
  stubProbes({ [PROD]: version("v1.14.0"), [BETA]: version("v1.15.0") });
  await refreshVersions(makeEnv(), EARLIER);
  stubProbes({ [PROD]: version("v1.14.0"), [BETA]: answer });
  await refreshVersions(makeEnv(), NOW);
  expect(await rowOf("beta")).toEqual({
    version: "v1.15.0",
    first_seen: EARLIER.toISOString(),
    last_seen: EARLIER.toISOString(),
  });
  expect(await rowOf("production")).toMatchObject({ last_seen: NOW.toISOString() });
});

test("a probe slower than 3 seconds is abandoned", async () => {
  /** @type {AbortSignal | undefined} */
  let signal;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_, init) => {
    signal = init?.signal ?? undefined;
    return Response.json({ ok: true, version: "v1" });
  });
  await refreshVersions(makeEnv(), NOW);
  expect(signal).toBeInstanceOf(AbortSignal);
});

test("a product with no environments, or unreadable ones, isn't probed", async () => {
  await configure("cl", []);
  await baseEnv.DB.exec(`UPDATE products SET environments = '[{"name":' WHERE slug = 'deaftly'`);
  const calls = stubProbes({});
  await refreshVersions(makeEnv(), NOW);
  expect(calls).toEqual([]);
});

test("only https health URLs and known environment names are probed", async () => {
  await configure("cl", [
    { name: "production", healthUrl: "http://my.climbinglogbook.example/health" },
    { name: "staging", healthUrl: BETA },
    { name: "beta", healthUrl: BETA },
  ]);
  const calls = stubProbes({ [BETA]: version("v1.15.0") });
  await refreshVersions(makeEnv(), NOW);
  expect(calls).toEqual([BETA]);
});

test("the five-minute cron tracks versions", async () => {
  stubProbes({ [PROD]: version("v1.14.0"), [BETA]: version("v1.15.0") });
  const ctx = makeCtx();
  await worker.scheduled({ scheduledTime: NOW.getTime(), cron: "*/5 * * * *" }, makeEnv(), ctx);
  await ctx.settled();
  expect(await rowOf("beta")).toMatchObject({ version: "v1.15.0" });
});
