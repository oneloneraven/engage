import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { clearInstallationTokens } from "../src/github/app.js";
import { createRelease, decideRelease } from "../src/releases/store.js";
import worker from "../src/worker.js";
import { makeCtx, makeEnv } from "./helpers.js";

const HOST = "https://localhost";
const REPO = "oneloneraven/climbing-logbook";
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

const adminEnv = () =>
  makeEnv({
    APP_ENV: "e2e",
    ADMIN_HOST: "localhost",
    ADMIN_ACCESS_CHECK: "off",
    ASSETS: { fetch: async () => new Response("asset") },
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: pem,
  });

/** @param {string} method @param {string} path @param {unknown} [body] */
async function call(method, path, body) {
  const ctx = makeCtx();
  const response = await worker.fetch(
    new Request(`${HOST}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    adminEnv(),
    ctx,
  );
  await ctx.settled();
  return response;
}

/** @param {{ review?: number }} [options] */
function stubGithub({ review = 204 } = {}) {
  /** @type {{ method: string, url: string, body: any }[]} */
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/orgs/oneloneraven/installation")) return Response.json({ id: 42 });
    if (url.endsWith("/app/installations/42/access_tokens"))
      return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (url.endsWith("/deployment_protection_rule")) return new Response(null, { status: review });
    if (url.includes("/compare/"))
      return Response.json({
        commits: [
          { commit: { message: "Fix the blank map (#1741)\n\nBody" } },
          { commit: { message: "Merge branch 'main'" } },
          { commit: { message: "Bump vite (#1742)" } },
        ],
      });
    if (url.includes("/check-runs"))
      return Response.json({
        check_runs: [
          {
            status: "completed",
            conclusion: "success",
            details_url: `https://github.com/${REPO}/actions/runs/40/job/1`,
          },
          { status: "waiting", conclusion: null, details_url: `https://github.com/${REPO}/actions/runs/42/job/2` },
        ],
      });
    if (/\/actions\/runs\/\d+$/.test(url))
      return Response.json({ html_url: `https://github.com/${REPO}/actions/runs/42` });
    return new Response("unexpected", { status: 599 });
  });
  return calls;
}

/** @param {Partial<Parameters<typeof createRelease>[1]>} [fields] */
const seed = async (fields = {}) =>
  (
    await createRelease(baseEnv, {
      repo: REPO,
      product: "cl",
      environment: "production",
      sha: "new-sha",
      ref: "v1.14.0",
      runId: 42,
      callbackUrl: `https://api.github.com/repos/${REPO}/actions/runs/42/deployment_protection_rule`,
      installationId: 7,
      ...fields,
    })
  ).id;

beforeEach(async () => {
  await baseEnv.DB.exec("DELETE FROM releases");
  clearInstallationTokens();
});
afterEach(() => vi.restoreAllMocks());

describe("reading releases", () => {
  test("lists releases, filters by state, refuses an unknown state, and counts those waiting", async () => {
    await seed();
    const listed = await (await call("GET", "/api/releases?state=pending")).json();
    expect(listed.releases).toHaveLength(1);
    expect(listed.releases[0]).toMatchObject({ repo: REPO, productName: "Climbing Logbook", state: "pending" });
    expect((await (await call("GET", "/api/releases?state=approved")).json()).releases).toEqual([]);
    expect((await call("GET", "/api/releases?state=bogus")).status).toBe(400);
    expect((await (await call("GET", "/api/counts")).json()).releasesWaiting).toBe(1);
  });

  test("filters by product, and each product's latest release out is in the counts", async () => {
    const out = await seed({ runId: 40, ref: "v1.13.0" });
    await decideRelease(makeEnv(), out, "approved", "owner@example.com", null);
    await seed({ runId: 41, ref: "v1.14.0" });
    await baseEnv.DB.exec("UPDATE releases SET created_at = '2026-11-01T00:00:00.000Z' WHERE run_id = 40");
    await createRelease(makeEnv(), {
      repo: "oneloneraven/deaftly",
      product: "deaftly",
      environment: "release",
      sha: "d-sha",
      ref: "v2.0.0",
      runId: 50,
      callbackUrl: "https://api.github.com/repos/oneloneraven/deaftly/actions/runs/50/deployment_protection_rule",
      installationId: 7,
    });
    const cl = (await (await call("GET", "/api/releases?product=cl")).json()).releases;
    expect(cl.map((/** @type {any} */ r) => r.ref)).toEqual(["v1.14.0", "v1.13.0"]);
    const waiting = (await (await call("GET", "/api/releases?product=deaftly&state=pending")).json()).releases;
    expect(waiting.map((/** @type {any} */ r) => r.ref)).toEqual(["v2.0.0"]);
    const { byProduct } = await (await call("GET", "/api/counts")).json();
    expect(byProduct.cl.latestRelease).toMatchObject({ id: out, ref: "v1.13.0", environment: "production" });
    expect(byProduct.deaftly.latestRelease).toBeNull();
  });

  test("a release's detail lists the PRs since the last one out to that environment, and its checks", async () => {
    const earlier = await seed({ sha: "old-sha", runId: 41 });
    await decideRelease(baseEnv, earlier, "approved", "owner@example.test");
    const id = await seed();
    const calls = stubGithub();
    const detail = await (await call("GET", `/api/releases/${id}`)).json();
    expect(detail.pulls).toEqual([
      { number: 1741, title: "Fix the blank map", url: `https://github.com/${REPO}/pull/1741` },
      { number: 1742, title: "Bump vite", url: `https://github.com/${REPO}/pull/1742` },
    ]);
    expect(detail.checks).toEqual({ conclusion: "success", url: `https://github.com/${REPO}/actions/runs/42` });
    expect(calls.some(c => c.url.endsWith(`/repos/${REPO}/compare/old-sha...new-sha`))).toBe(true);
  });

  test("with no earlier release there are no PRs, and GitHub being down degrades to unknown checks", async () => {
    const id = await seed();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    const detail = await (await call("GET", `/api/releases/${id}`)).json();
    expect(detail).toMatchObject({ pulls: [], checks: { conclusion: "unknown", url: null } });
    expect((await call("GET", "/api/releases/nope")).status).toBe(404);
  });
});

describe("deciding", () => {
  test("approve tells GitHub, with the note, and records the decision", async () => {
    const id = await seed();
    const calls = stubGithub();
    const response = await call("POST", `/api/releases/${id}/approve`, { note: "Ship it" });
    expect(response.status).toBe(200);
    expect((await response.json()).release).toMatchObject({ state: "approved", note: "Ship it" });
    const review = calls.find(c => c.url.endsWith("/deployment_protection_rule"));
    expect(review).toEqual({
      method: "POST",
      url: `https://api.github.com/repos/${REPO}/actions/runs/42/deployment_protection_rule`,
      body: { environment_name: "production", state: "approved", comment: "Approved in Engage: Ship it" },
    });
  });

  test("reject sends rejected, and a decided release can't be decided again", async () => {
    const id = await seed();
    const calls = stubGithub();
    expect((await call("POST", `/api/releases/${id}/reject`, {})).status).toBe(200);
    expect(calls.find(c => c.url.endsWith("/deployment_protection_rule"))?.body).toMatchObject({
      state: "rejected",
      comment: "Rejected in Engage",
    });
    const again = await call("POST", `/api/releases/${id}/approve`, {});
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "release-not-pending" });
  });

  test("a run GitHub no longer waits on is marked expired", async () => {
    const id = await seed();
    stubGithub({ review: 422 });
    const response = await call("POST", `/api/releases/${id}/approve`, {});
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "release-expired" });
    const [row] = (await baseEnv.DB.prepare("SELECT state FROM releases WHERE id = ?").bind(id).all()).results;
    expect(row.state).toBe("expired");
  });

  test("a note over 1,000 characters is refused, and so is any other field", async () => {
    const id = await seed();
    stubGithub();
    expect((await call("POST", `/api/releases/${id}/approve`, { note: "x".repeat(1001) })).status).toBe(400);
    expect((await call("POST", `/api/releases/${id}/approve`, { state: "spent" })).status).toBe(400);
  });
});
