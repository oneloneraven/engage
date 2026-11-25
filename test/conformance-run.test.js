import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { runConformance } from "../src/conformance/run.js";
import { clearInstallationTokens } from "../src/github/app.js";
import { contents, stubGithub } from "./github-stub.js";
import { makeEnv } from "./helpers.js";

const NOW = new Date("2026-11-26T03:17:00.000Z");
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

const testEnv = () => makeEnv({ GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: pem });

const RULES = {
  version: 1,
  checks: [
    { id: "bootstrap-record", title: "Bootstrap record", kind: "record-present", modules: [] },
    { id: "core-docs", title: "Core docs", kind: "files-present", modules: ["core"], paths: ["SECURITY.md"] },
    { id: "android", title: "Android only", kind: "files-present", modules: ["android-toolchain"], paths: ["gradlew"] },
    {
      id: "board-sync",
      title: "Board sync",
      kind: "workflow-healthy",
      modules: ["core"],
      workflow: "sync.yml",
      step: "github:core:5",
    },
    { id: "future", title: "Future", kind: "not-yet-a-kind", modules: [] },
  ],
  requiredChecks: {},
};

const TOKEN_ROUTES = {
  "/orgs/oneloneraven/installation": { id: 1 },
};

/** @param {{ rules?: unknown, repositories?: unknown[], extra?: Record<string, unknown> }} [options] */
function stub({ rules = contents(RULES), repositories, extra = {} } = {}) {
  const fetchStub = stubGithub({
    ...TOKEN_ROUTES,
    "/repos/oneloneraven/project-bootstrap/contents/conformance/rules.json": rules,
    "/installation/repositories?per_page=100&page=1": {
      repositories: repositories ?? [
        { full_name: "oneloneraven/engage", default_branch: "main", archived: false, fork: false },
        { full_name: "oneloneraven/old", default_branch: "main", archived: true, fork: false },
        { full_name: "oneloneraven/forked", default_branch: "main", archived: false, fork: true },
        { full_name: "oneloneraven/deaftly", default_branch: "main", archived: false, fork: false },
        { full_name: "oneloneraven/climbing-logbook", default_branch: "main", archived: false, fork: false },
        { full_name: "oneloneraven/deaftly-website", default_branch: "main", archived: false, fork: false },
      ],
    },
    "/repos/oneloneraven/engage/contents/.bootstrap/state.json?ref=main": contents({
      modules: ["core"],
      skipped: { "github:core:5-link": "user project can't link an org repo" },
    }),
    "/repos/oneloneraven/engage/contents/.bootstrap/github/labels.json?ref=main": contents([]),
    "/repos/oneloneraven/engage/contents/SECURITY.md?ref=main": {},
    "/repos/oneloneraven/deaftly/contents/.bootstrap/state.json?ref=main": { status: 500 },
    ...extra,
  });
  return fetchStub;
}

/** The access token exchange answers a POST; the stub answers by path, whatever the method. */
const accessToken = { "/app/installations/1/access_tokens": { token: "inst", expires_at: "2099-01-01T00:00:00Z" } };

/** @param {string} repo */
async function cells(repo) {
  const { results } = await baseEnv.DB.prepare(
    "SELECT check_id, status, reason FROM conformance_results WHERE repo = ? ORDER BY check_id",
  )
    .bind(repo)
    .all();
  return Object.fromEntries(results.map(row => [row.check_id, { status: row.status, reason: row.reason }]));
}

const lastRun = () => baseEnv.DB.prepare("SELECT * FROM conformance_runs ORDER BY id DESC LIMIT 1").first();

beforeEach(async () => {
  clearInstallationTokens();
  for (const table of ["conformance_results", "conformance_checks", "conformance_runs"])
    await baseEnv.DB.exec(`DELETE FROM ${table}`);
});
afterEach(() => vi.restoreAllMocks());

test("a run stores every repository's cell for every check, with the states the spec gives them", async () => {
  stub({ extra: accessToken });
  await runConformance(testEnv(), NOW);
  expect(await cells("oneloneraven/engage")).toEqual({
    "bootstrap-record": { status: "pass", reason: "" },
    "core-docs": { status: "pass", reason: "" },
    android: { status: "n/a", reason: "Doesn't apply" },
    "board-sync": { status: "skipped", reason: "Skipped at bootstrap: user project can't link an org repo" },
    future: { status: "unknown", reason: "Engage doesn't know this check yet" },
  });
  expect(await cells("oneloneraven/climbing-logbook")).toMatchObject({
    "bootstrap-record": { status: "fail", reason: "Bootstrap hasn't set this repository up" },
    "core-docs": { status: "n/a", reason: "Not checked: no bootstrap record" },
  });
  expect(Object.values(await cells("oneloneraven/deaftly")).map(c => c.status)).toEqual([
    "unknown",
    "unknown",
    "unknown",
    "unknown",
    "unknown",
  ]);
  expect(await cells("oneloneraven/old")).toEqual({});
  expect(await cells("oneloneraven/forked")).toEqual({});
  expect(await lastRun()).toMatchObject({ complete: 1, rules_version: 1, error: null });
  const columns = await baseEnv.DB.prepare("SELECT id FROM conformance_checks ORDER BY position").all();
  expect(columns.results.map(row => row.id)).toEqual([
    "bootstrap-record",
    "core-docs",
    "android",
    "board-sync",
    "future",
  ]);
});

test("a registry repository the installation doesn't list gets a row of unknowns, and a vanished one is removed", async () => {
  await baseEnv.DB.exec(
    "INSERT INTO conformance_results (repo, check_id, status, reason, checked_at) VALUES ('oneloneraven/gone', 'core-docs', 'fail', 'x', '2026-11-01T00:00:00Z')",
  );
  stub({
    extra: accessToken,
    repositories: [{ full_name: "oneloneraven/engage", default_branch: "main", archived: false, fork: false }],
  });
  await runConformance(testEnv(), NOW);
  expect(await cells("oneloneraven/climbing-logbook")).toMatchObject({
    "core-docs": { status: "unknown", reason: "Engage's App can't see this repository" },
  });
  expect(await cells("oneloneraven/gone")).toEqual({});
});

test("when the rules can't be read, the last results stay and the run says why", async () => {
  stub({ extra: accessToken });
  await runConformance(testEnv(), NOW);
  const before = await cells("oneloneraven/engage");
  stub({ extra: accessToken, rules: { status: 500 } });
  await runConformance(testEnv(), NOW);
  expect(await cells("oneloneraven/engage")).toEqual(before);
  expect(await lastRun()).toMatchObject({ complete: 0, error: "rules-unavailable" });
  stub({ extra: accessToken, rules: contents("not json") });
  await runConformance(testEnv(), NOW);
  expect(await lastRun()).toMatchObject({ complete: 0, error: "rules-malformed" });
});

test("a rules version Engage doesn't support makes every cell unknown", async () => {
  stub({ extra: accessToken, rules: contents({ ...RULES, version: 2 }) });
  await runConformance(testEnv(), NOW);
  expect(await cells("oneloneraven/engage")).toMatchObject({
    "core-docs": { status: "unknown", reason: "Engage doesn't support rules version 2" },
  });
});

test("without the App configured, nothing is read and the run records it", async () => {
  const asked = stub();
  await runConformance(makeEnv({ GITHUB_APP_ID: undefined, GITHUB_APP_PRIVATE_KEY: undefined }), NOW);
  expect(asked).toEqual([]);
  expect(await lastRun()).toMatchObject({ complete: 0, error: "github-app-unavailable" });
});
