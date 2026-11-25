import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { refreshHealth } from "../src/signals/health.js";
import worker from "../src/worker.js";
import { makeBucket, makeCtx, makeEnv, resetItems } from "./helpers.js";

const NOW = new Date("2026-11-25T12:05:00.000Z");
const API = "https://incidents.betterstack.com/api";
const MONITORS = [
  { id: "101", name: "Climbing Logbook app", url: "https://uptime.example/monitors/101" },
  { id: "102", name: "Climbing Logbook beta", url: "https://uptime.example/monitors/102" },
];

/** @param {Record<string, string>} statuses */
const monitorPage = (statuses, next = null) => ({
  data: Object.entries(statuses).map(([id, status]) => ({ id, type: "monitor", attributes: { status } })),
  pagination: { next },
});

/** @param {string[]} monitorIds */
const incidentPage = monitorIds => ({
  data: monitorIds.map((id, n) => ({
    id: `i${n}`,
    type: "incident",
    attributes: { resolved_at: null, status: "Started" },
    relationships: { monitor: { data: { id, type: "monitor" } } },
  })),
  pagination: { next: null },
});

/**
 * @param {{ monitors?: any[], incidents?: any, fail?: number | "network" }} answers
 */
function stubBetterStack({
  monitors = [monitorPage({ 101: "up", 102: "up" })],
  incidents = incidentPage([]),
  fail,
} = {}) {
  /** @type {{ url: string, auth: string | null }[]} */
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    if (fail === "network") throw new TypeError("network down");
    if (fail) return new Response("no", { status: fail });
    if (url.startsWith(`${API}/v2/monitors`)) {
      const page = Number(new URL(url).searchParams.get("page") ?? 1);
      return Response.json(monitors[page - 1]);
    }
    if (url.startsWith(`${API}/v5/incidents`)) return Response.json(incidents);
    return new Response("unexpected", { status: 599 });
  });
  return calls;
}

/** @param {unknown} sources */
async function configure(slug, sources) {
  await baseEnv.DB.prepare("UPDATE products SET health_sources = ? WHERE slug = ?")
    .bind(JSON.stringify(sources), slug)
    .run();
}

/** @param {string} slug */
const stateOf = slug =>
  baseEnv.DB.prepare("SELECT status, reason, link, checked_at FROM health_state WHERE product = ?").bind(slug).first();

const testEnv = (overrides = {}) => makeEnv({ BETTER_STACK_TOKEN: "bs-token", ...overrides });

beforeEach(async () => {
  await baseEnv.DB.exec("DELETE FROM health_state");
  await baseEnv.DB.exec("UPDATE products SET health_sources = '{}'");
  await configure("cl", { betterStack: { monitors: MONITORS } });
});
afterEach(() => vi.restoreAllMocks());

test("all monitors up with no open incident is healthy", async () => {
  const calls = stubBetterStack();
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toEqual({ status: "healthy", reason: null, link: null, checked_at: NOW.toISOString() });
  expect(calls.every(call => call.auth === "Bearer bs-token")).toBe(true);
  expect(calls.find(call => call.url.includes("/v5/incidents"))?.url).toContain("resolved=false");
});

test("a down monitor makes the product failing, linking to that monitor", async () => {
  stubBetterStack({ monitors: [monitorPage({ 101: "down", 102: "up" })] });
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toMatchObject({
    status: "failing",
    reason: "Climbing Logbook app is down",
    link: MONITORS[0].url,
  });
});

test("two down monitors are counted in the reason", async () => {
  stubBetterStack({ monitors: [monitorPage({ 101: "down", 102: "down" })] });
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toMatchObject({
    status: "failing",
    reason: "Climbing Logbook app and 1 more are down",
  });
});

test("a recovering monitor makes the product degraded", async () => {
  stubBetterStack({ monitors: [monitorPage({ 101: "up", 102: "validating" })] });
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toMatchObject({
    status: "degraded",
    reason: "Climbing Logbook beta is recovering",
    link: MONITORS[1].url,
  });
});

test("an open incident on a monitor that's up makes the product degraded", async () => {
  stubBetterStack({ incidents: incidentPage(["101"]) });
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toMatchObject({ status: "degraded", reason: "Open incident on Climbing Logbook app" });
});

test("down outranks recovering", async () => {
  stubBetterStack({ monitors: [monitorPage({ 101: "validating", 102: "down" })] });
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toMatchObject({ status: "failing", reason: "Climbing Logbook beta is down" });
});

test("paused, pending and maintenance monitors are left out", async () => {
  stubBetterStack({ monitors: [monitorPage({ 101: "up", 102: "paused" })], incidents: incidentPage(["102"]) });
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toMatchObject({ status: "healthy" });

  stubBetterStack({ monitors: [monitorPage({ 101: "maintenance", 102: "pending" })] });
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toMatchObject({ status: "unmonitored", reason: null });
});

test("a configured monitor Better Stack doesn't have is unknown, not healthy", async () => {
  stubBetterStack({ monitors: [monitorPage({ 101: "up" })] });
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toMatchObject({
    status: "unknown",
    reason: "Climbing Logbook beta isn't in Better Stack",
  });
});

test("every page of monitors is read", async () => {
  stubBetterStack({
    monitors: [monitorPage({ 101: "up" }, `${API}/v2/monitors?page=2&per_page=250`), monitorPage({ 102: "down" })],
  });
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("cl")).toMatchObject({ status: "failing", reason: "Climbing Logbook beta is down" });
});

test("a next page on another host isn't followed, so the token never leaves Better Stack", async () => {
  const calls = stubBetterStack({
    monitors: [monitorPage({ 101: "up", 102: "up" }, "https://elsewhere.example/api/v2/monitors?page=2")],
  });
  await refreshHealth(testEnv(), NOW);
  expect(calls.some(call => call.url.startsWith("https://elsewhere.example"))).toBe(false);
  expect(await stateOf("cl")).toMatchObject({ status: "unknown", reason: "Couldn't reach Better Stack" });
});

test("a product without monitors is unmonitored, and Better Stack isn't asked about it", async () => {
  await configure("cl", {});
  const calls = stubBetterStack();
  await refreshHealth(testEnv(), NOW);
  expect(calls).toEqual([]);
  expect(await stateOf("cl")).toMatchObject({ status: "unmonitored", reason: null, link: null });
  expect(await stateOf("deaftly")).toMatchObject({ status: "unmonitored" });
});

test.each([[401], [500], ["network"]])(
  "Better Stack failing (%s) is unknown, never the last good status",
  async fail => {
    stubBetterStack();
    await refreshHealth(testEnv(), NOW);
    stubBetterStack({ fail: /** @type {number | "network"} */ (fail) });
    await refreshHealth(testEnv(), NOW);
    expect(await stateOf("cl")).toMatchObject({ status: "unknown", reason: "Couldn't reach Better Stack", link: null });
    expect(await stateOf("deaftly")).toMatchObject({ status: "unmonitored" });
  },
);

test("without a token, monitored products are unknown and nothing is fetched", async () => {
  const calls = stubBetterStack();
  await refreshHealth(testEnv({ BETTER_STACK_TOKEN: undefined }), NOW);
  expect(calls).toEqual([]);
  expect(await stateOf("cl")).toMatchObject({ status: "unknown", reason: "Better Stack isn't set up" });
});

test("malformed health config is unknown, and doesn't stop other products", async () => {
  await baseEnv.DB.exec(`UPDATE products SET health_sources = '{"betterStack":' WHERE slug = 'deaftly'`);
  stubBetterStack();
  await refreshHealth(testEnv(), NOW);
  expect(await stateOf("deaftly")).toMatchObject({ status: "unknown", reason: "Health settings can't be read" });
  expect(await stateOf("cl")).toMatchObject({ status: "healthy" });
});

test("each cron runs only its own jobs", async () => {
  await resetItems();
  await baseEnv.DB.exec(
    "INSERT INTO items (id, product, kind, source, junk, created_at, last_activity_at) VALUES ('old-junk', 'cl', 'feedback', 'web', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  );
  stubBetterStack();
  const env = testEnv({ ATTACHMENTS: makeBucket() });

  const fiveMinutes = makeCtx();
  await worker.scheduled({ scheduledTime: NOW.getTime(), cron: "*/5 * * * *" }, env, fiveMinutes);
  await fiveMinutes.settled();
  expect(await stateOf("cl")).toMatchObject({ status: "healthy" });
  expect(await baseEnv.DB.prepare("SELECT id FROM items WHERE id = 'old-junk'").first()).not.toBeNull();

  await baseEnv.DB.exec("DELETE FROM health_state");
  const daily = makeCtx();
  await worker.scheduled({ scheduledTime: NOW.getTime(), cron: "17 3 * * *" }, env, daily);
  await daily.settled();
  expect(await stateOf("cl")).toBeNull();
  expect(await baseEnv.DB.prepare("SELECT id FROM items WHERE id = 'old-junk'").first()).toBeNull();
});
