import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { clearInstallationTokens } from "../src/github/app.js";
import { snapshotMetrics } from "../src/signals/metrics.js";
import worker from "../src/worker.js";
import { makeBucket, makeCtx, makeEnv } from "./helpers.js";

const NOW = new Date("2026-11-25T03:17:00.000Z");
const YESTERDAY = "2026-11-24";
const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const USAGE = "https://admin.climbinglogbook.example/-/api/admin/usage";
const RELEASES = "https://api.github.com/repos/oneloneraven/deaftly/releases";
/** @type {string} */
let pem;

beforeAll(async () => {
  const keys = /** @type {CryptoKeyPair} */ (
    await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )
  );
  const der = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("pkcs8", keys.privateKey)));
  pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
});

const VISITS = { source: "web-visits", metric: "visits", label: "Visits, excluding EU visitors", siteTag: "site-cl" };
const ACTIVE = {
  source: "cl-usage",
  metric: "active-users",
  label: "People who logged a climb in the last 30 days",
  url: USAGE,
  field: "activeUsers",
  primary: true,
};
const DOWNLOADS = {
  source: "github-downloads",
  metric: "downloads",
  label: "Android downloads",
  repo: "oneloneraven/deaftly",
  assetPattern: "\\.apk$",
  primary: true,
};

const testEnv = (overrides = {}) =>
  makeEnv({
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CLOUDFLARE_ANALYTICS_TOKEN: "cf-analytics",
    CL_USAGE_CLIENT_ID: "client-id",
    CL_USAGE_CLIENT_SECRET: "client-secret",
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: pem,
    ...overrides,
  });

/**
 * @param {{
 *   visits?: (from: string) => number | null,
 *   graphqlErrors?: boolean,
 *   usage?: () => Response,
 *   releases?: any[][],
 * }} [answers]
 */
function stubSources({
  visits = () => 40,
  graphqlErrors = false,
  usage = () => Response.json({ users: 12, activeUsers: 7 }),
  releases = [[{ assets: [{ name: "deaftly-1.0.0.apk", download_count: 30 }] }]],
} = {}) {
  /** @type {{ url: string, headers: Headers, body: any }[]} */
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, headers: new Headers(init?.headers), body });
    if (url === GRAPHQL) {
      if (graphqlErrors) return Response.json({ data: null, errors: [{ message: "bad field" }] });
      const value = visits(body.variables.from);
      const groups = value === null ? [] : [{ sum: { visits: value } }];
      return Response.json({ data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: groups }] } } });
    }
    if (url === USAGE) return usage();
    if (url.endsWith("/orgs/oneloneraven/installation")) return Response.json({ id: 42 });
    if (url.endsWith("/app/installations/42/access_tokens"))
      return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (url.startsWith(RELEASES)) {
      const page = Number(new URL(url).searchParams.get("page") ?? 1);
      return Response.json(releases[page - 1] ?? []);
    }
    return new Response("unexpected", { status: 599 });
  });
  return calls;
}

/** @param {string} slug @param {unknown[]} engagement */
async function configure(slug, engagement) {
  await baseEnv.DB.prepare("UPDATE products SET engagement = ? WHERE slug = ?")
    .bind(JSON.stringify(engagement), slug)
    .run();
}

/** @param {string} product @param {string} metric */
async function snapshots(product, metric) {
  const rows = await baseEnv.DB.prepare(
    "SELECT day, value FROM metric_snapshots WHERE product = ? AND metric = ? ORDER BY day",
  )
    .bind(product, metric)
    .all();
  return rows.results;
}

beforeEach(async () => {
  clearInstallationTokens();
  await baseEnv.DB.exec("DELETE FROM metric_snapshots");
  await baseEnv.DB.exec("UPDATE products SET engagement = '[]'");
});
afterEach(() => vi.restoreAllMocks());

test("account usage is recorded against yesterday, with both Access headers", async () => {
  await configure("cl", [ACTIVE]);
  const calls = stubSources();
  await snapshotMetrics(testEnv(), NOW);
  expect(await snapshots("cl", "active-users")).toEqual([{ day: YESTERDAY, value: 7 }]);
  const call = calls.find(c => c.url === USAGE);
  expect(call?.headers.get("CF-Access-Client-Id")).toBe("client-id");
  expect(call?.headers.get("CF-Access-Client-Secret")).toBe("client-secret");
});

test("running twice the same day overwrites rather than duplicating", async () => {
  await configure("cl", [ACTIVE]);
  stubSources();
  await snapshotMetrics(testEnv(), NOW);
  stubSources({ usage: () => Response.json({ activeUsers: 9 }) });
  await snapshotMetrics(testEnv(), NOW);
  expect(await snapshots("cl", "active-users")).toEqual([{ day: YESTERDAY, value: 9 }]);
});

test.each([
  ["a string", "7"],
  ["a negative number", -1],
  ["a fraction", 1.5],
  ["nothing", undefined],
])("a usage field that's %s isn't recorded", async (_, value) => {
  await configure("cl", [ACTIVE]);
  stubSources({ usage: () => Response.json({ activeUsers: value }) });
  await snapshotMetrics(testEnv(), NOW);
  expect(await snapshots("cl", "active-users")).toEqual([]);
});

test("visits are read for each UTC day by site tag, and missing days in the last 30 are filled", async () => {
  await configure("cl", [VISITS]);
  const calls = stubSources({ visits: from => Number(from.slice(8, 10)) });
  await snapshotMetrics(testEnv(), NOW);
  const rows = await snapshots("cl", "visits");
  expect(rows).toHaveLength(30);
  expect(rows[0]).toEqual({ day: "2026-10-26", value: 26 });
  expect(rows[29]).toEqual({ day: YESTERDAY, value: 24 });
  const first = calls.find(c => c.url === GRAPHQL);
  expect(first?.headers.get("Authorization")).toBe("Bearer cf-analytics");
  expect(first?.body.variables).toMatchObject({ accountTag: "acct", siteTag: "site-cl" });
  expect(first?.body.query).toContain("rumPageloadEventsAdaptiveGroups");

  const next = stubSources({ visits: () => 99 });
  await snapshotMetrics(testEnv(), new Date("2026-11-26T03:17:00.000Z"));
  expect(next.filter(c => c.url === GRAPHQL).map(c => c.body.variables.from)).toEqual(["2026-11-25T00:00:00.000Z"]);
});

test("a day with no visits is recorded as zero", async () => {
  await configure("cl", [VISITS]);
  stubSources({ visits: () => null });
  await snapshotMetrics(testEnv(), NOW);
  expect((await snapshots("cl", "visits")).every(row => row.value === 0)).toBe(true);
});

test("GraphQL errors record nothing", async () => {
  await configure("cl", [VISITS]);
  stubSources({ graphqlErrors: true });
  await snapshotMetrics(testEnv(), NOW);
  expect(await snapshots("cl", "visits")).toEqual([]);
});

test("downloads sum matching assets over every page of releases", async () => {
  await configure("deaftly", [DOWNLOADS]);
  const firstPage = Array.from({ length: 100 }, () => ({
    assets: [
      { name: "deaftly.apk", download_count: 1 },
      { name: "notes.txt", download_count: 500 },
    ],
  }));
  stubSources({ releases: [firstPage, [{ assets: [{ name: "deaftly-0.1.0.apk", download_count: 5 }] }]] });
  await snapshotMetrics(testEnv(), NOW);
  expect(await snapshots("deaftly", "downloads")).toEqual([{ day: YESTERDAY, value: 105 }]);
});

test("one source failing doesn't stop the others", async () => {
  await configure("cl", [ACTIVE, VISITS]);
  await configure("deaftly", [DOWNLOADS]);
  stubSources({ usage: () => new Response("no", { status: 403 }) });
  await snapshotMetrics(testEnv(), NOW);
  expect(await snapshots("cl", "active-users")).toEqual([]);
  expect(await snapshots("cl", "visits")).toHaveLength(30);
  expect(await snapshots("deaftly", "downloads")).toEqual([{ day: YESTERDAY, value: 30 }]);
});

test("a source whose secrets are missing isn't called", async () => {
  await configure("cl", [ACTIVE, VISITS]);
  const calls = stubSources();
  await snapshotMetrics(testEnv({ CL_USAGE_CLIENT_SECRET: undefined, CLOUDFLARE_ANALYTICS_TOKEN: undefined }), NOW);
  expect(calls).toEqual([]);
  expect(await snapshots("cl", "active-users")).toEqual([]);
});

test("unknown sources and unreadable config are skipped", async () => {
  await configure("cl", [{ source: "play-store", metric: "installs" }, ACTIVE]);
  await baseEnv.DB.exec(`UPDATE products SET engagement = '[{"source":' WHERE slug = 'deaftly'`);
  stubSources();
  await snapshotMetrics(testEnv(), NOW);
  expect(await snapshots("cl", "active-users")).toEqual([{ day: YESTERDAY, value: 7 }]);
  expect(await snapshots("cl", "installs")).toEqual([]);
});

test("the daily cron takes the snapshots, and the five-minute one doesn't", async () => {
  await configure("cl", [ACTIVE]);
  stubSources();
  const env = testEnv({ ATTACHMENTS: makeBucket() });
  const fiveMinutes = makeCtx();
  await worker.scheduled({ scheduledTime: NOW.getTime(), cron: "*/5 * * * *" }, env, fiveMinutes);
  await fiveMinutes.settled();
  expect(await snapshots("cl", "active-users")).toEqual([]);
  const daily = makeCtx();
  await worker.scheduled({ scheduledTime: NOW.getTime(), cron: "17 3 * * *" }, env, daily);
  await daily.settled();
  expect(await snapshots("cl", "active-users")).toEqual([{ day: YESTERDAY, value: 7 }]);
});
