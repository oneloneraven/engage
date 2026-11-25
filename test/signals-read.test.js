import { env as baseEnv } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { readSignals } from "../src/signals/read.js";
import { makeEnv } from "./helpers.js";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const DAY_MS = 86_400_000;
/** @param {number} n days before yesterday (0 is yesterday) */
const day = n => new Date(Date.parse("2026-11-24") - n * DAY_MS).toISOString().slice(0, 10);
const minutesAgo = (/** @type {number} */ n) => new Date(NOW.getTime() - n * 60_000).toISOString();
const daysAgo = (/** @type {number} */ n) => new Date(NOW.getTime() - n * DAY_MS).toISOString();

/** @param {string} slug @param {string} status @param {{ reason?: string | null, link?: string | null, checkedAt?: string }} [rest] */
async function health(slug, status, { reason = null, link = null, checkedAt = minutesAgo(2) } = {}) {
  await baseEnv.DB.prepare(
    "INSERT INTO health_state (product, status, reason, link, checked_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(slug, status, reason, link, checkedAt)
    .run();
}

/** @param {string} slug @param {unknown[]} engagement */
async function engagement(slug, engagement) {
  await baseEnv.DB.prepare("UPDATE products SET engagement = ? WHERE slug = ?")
    .bind(JSON.stringify(engagement), slug)
    .run();
}

/** @param {string} metric @param {[number, number][]} rows [days before yesterday, value] */
async function snapshots(metric, rows) {
  await baseEnv.DB.batch(
    rows.map(([n, value]) =>
      baseEnv.DB.prepare("INSERT INTO metric_snapshots (product, metric, day, value) VALUES ('cl', ?, ?, ?)").bind(
        metric,
        day(n),
        value,
      ),
    ),
  );
}

/** @param {string} environment @param {string} version @param {string} firstSeen */
async function deployed(environment, version, firstSeen) {
  await baseEnv.DB.prepare(
    "INSERT INTO deployed_versions (product, environment, version, first_seen, last_seen) VALUES ('cl', ?, ?, ?, ?)",
  )
    .bind(environment, version, firstSeen, minutesAgo(1))
    .run();
}

const VISITS = { source: "web-visits", metric: "visits", label: "Visits in the last 30 days", primary: true };
const ACTIVE = { source: "cl-usage", metric: "active-users", label: "Active climbers", primary: true };
const DOWNLOADS = { source: "github-downloads", metric: "downloads", label: "Downloads", primary: true };

beforeEach(async () => {
  for (const table of ["health_state", "metric_snapshots", "deployed_versions"])
    await baseEnv.DB.exec(`DELETE FROM ${table}`);
  await baseEnv.DB.exec("UPDATE products SET engagement = '[]', beta_amber_days = 7");
});

test("fresh health comes back as stored", async () => {
  await health("cl", "failing", { reason: "Climbing Logbook app is down", link: "https://uptime.example/1" });
  const signals = await readSignals(makeEnv(), NOW);
  expect(signals.cl.health).toEqual({
    status: "failing",
    reason: "Climbing Logbook app is down",
    link: "https://uptime.example/1",
    checkedAt: minutesAgo(2),
  });
});

test("health older than 15 minutes is unknown, saying when it was last checked", async () => {
  await health("cl", "healthy", { checkedAt: minutesAgo(40) });
  const signals = await readSignals(makeEnv(), NOW);
  expect(signals.cl.health).toMatchObject({ status: "unknown", reason: "Last checked 40 minutes ago", link: null });
});

test("a product never checked is unknown", async () => {
  const signals = await readSignals(makeEnv(), NOW);
  expect(signals.deaftly.health).toEqual({ status: "unknown", reason: "Not checked yet", link: null, checkedAt: null });
});

test("no engagement configured is null, and configured but empty has no number", async () => {
  expect((await readSignals(makeEnv(), NOW)).cl.engagement).toBeNull();
  await engagement("cl", [VISITS]);
  expect((await readSignals(makeEnv(), NOW)).cl.engagement).toEqual({
    label: VISITS.label,
    value: null,
    series: [],
    change: null,
  });
});

test("visits sum the last 30 days, with the change on the 30 before", async () => {
  await engagement("cl", [
    { ...VISITS, primary: false },
    { ...VISITS, metric: "other", primary: false },
  ]);
  await snapshots("visits", [
    ...Array.from({ length: 30 }, (_, n) => /** @type {[number, number]} */ ([n, 12])),
    ...Array.from({ length: 30 }, (_, n) => /** @type {[number, number]} */ ([n + 30, 10])),
  ]);
  const { engagement: result } = (await readSignals(makeEnv(), NOW)).cl;
  expect(result?.value).toBe(360);
  expect(result?.change).toBe(20);
  expect(result?.series).toHaveLength(30);
  expect(result?.series[29]).toEqual({ day: day(0), value: 12 });
});

test("no change until both windows have at least 25 days", async () => {
  await engagement("cl", [VISITS]);
  await snapshots("visits", [
    ...Array.from({ length: 30 }, (_, n) => /** @type {[number, number]} */ ([n, 12])),
    ...Array.from({ length: 24 }, (_, n) => /** @type {[number, number]} */ ([n + 30, 10])),
  ]);
  expect((await readSignals(makeEnv(), NOW)).cl.engagement?.change).toBeNull();
});

test("no change from a previous month of zero", async () => {
  await engagement("cl", [VISITS]);
  await snapshots("visits", [
    ...Array.from({ length: 30 }, (_, n) => /** @type {[number, number]} */ ([n, 12])),
    ...Array.from({ length: 30 }, (_, n) => /** @type {[number, number]} */ ([n + 30, 0])),
  ]);
  expect((await readSignals(makeEnv(), NOW)).cl.engagement?.change).toBeNull();
});

test("a rolling figure shows its latest value against 30 days before", async () => {
  await engagement("cl", [ACTIVE]);
  await snapshots("active-users", [
    [0, 9],
    [1, 8],
    [30, 12],
  ]);
  const { engagement: result } = (await readSignals(makeEnv(), NOW)).cl;
  expect(result).toMatchObject({ label: ACTIVE.label, value: 9, change: -25 });
  expect(result?.series.map(point => point.value)).toEqual([8, 9]);
});

test("a rolling figure with no value 30 days before has no change", async () => {
  await engagement("cl", [ACTIVE]);
  await snapshots("active-users", [[0, 9]]);
  expect((await readSignals(makeEnv(), NOW)).cl.engagement).toMatchObject({ value: 9, change: null });
});

test("download totals become downloads per day, never negative", async () => {
  await engagement("cl", [DOWNLOADS]);
  await snapshots("downloads", [
    [3, 100],
    [2, 104],
    [1, 103],
    [0, 110],
  ]);
  const { engagement: result } = (await readSignals(makeEnv(), NOW)).cl;
  expect(result?.series).toEqual([
    { day: day(2), value: 4 },
    { day: day(1), value: 0 },
    { day: day(0), value: 7 },
  ]);
  expect(result?.value).toBe(11);
});

test("beta shows when its version differs from production's, amber after the configured days", async () => {
  await deployed("production", "v1.14.0", daysAgo(20));
  await deployed("beta", "v1.15.0", daysAgo(3));
  expect((await readSignals(makeEnv(), NOW)).cl.beta).toEqual({
    version: "v1.15.0",
    production: "v1.14.0",
    since: daysAgo(3),
    amber: false,
  });
  await baseEnv.DB.exec("UPDATE products SET beta_amber_days = 2 WHERE slug = 'cl'");
  expect((await readSignals(makeEnv(), NOW)).cl.beta?.amber).toBe(true);
});

test("no beta badge when versions match or either is missing", async () => {
  await deployed("production", "v1.15.0", daysAgo(1));
  expect((await readSignals(makeEnv(), NOW)).cl.beta).toBeNull();
  await deployed("beta", "v1.15.0", daysAgo(3));
  expect((await readSignals(makeEnv(), NOW)).cl.beta).toBeNull();
});
