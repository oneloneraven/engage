import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { handleDeployCredentials } from "../src/releases/broker.js";
import { clearJwksCache } from "../src/releases/oidc.js";
import { createRelease, decideRelease } from "../src/releases/store.js";
import { makeEnv, makeLimiter } from "./helpers.js";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const REPO = "oneloneraven/climbing-logbook";
const POLICIES = [
  { effect: "allow", resources: { "com.cloudflare.api.account.1": "*" }, permission_groups: [{ id: "pg" }] },
];
/** @type {CryptoKeyPair} */
let keys;
/** @type {{ kid: string, kty: string, n: string, e: string }} */
let jwk;

/** @param {Uint8Array | string} value */
const b64url = value =>
  btoa(String.fromCharCode(...(typeof value === "string" ? new TextEncoder().encode(value) : value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

beforeAll(async () => {
  keys = /** @type {CryptoKeyPair} */ (
    await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )
  );
  const exported = /** @type {JsonWebKey} */ (await crypto.subtle.exportKey("jwk", keys.publicKey));
  jwk = { kid: "k", kty: "RSA", n: String(exported.n), e: String(exported.e) };
});

/** @param {Record<string, unknown>} [claims] */
async function oidc(claims = {}) {
  const head = b64url(JSON.stringify({ alg: "RS256", kid: "k" }));
  const body = b64url(
    JSON.stringify({
      iss: "https://token.actions.githubusercontent.com",
      aud: "engage",
      exp: NOW / 1000 + 300,
      repository: REPO,
      workflow_ref: `${REPO}/.github/workflows/deploy.yml@refs/tags/v1.14.0`,
      ref: "refs/tags/v1.14.0",
      sha: "abc123",
      environment: "production",
      run_id: "4242",
      run_attempt: "1",
      ...claims,
    }),
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${head}.${body}`)),
  );
  return `${head}.${body}.${b64url(sig)}`;
}

const brokerEnv = (overrides = {}) =>
  makeEnv({ CLOUDFLARE_BROKER_TOKEN: "parent-token", CLOUDFLARE_ACCOUNT_ID: "acct", ...overrides });
const options = { now: NOW, fetchJwks: async () => ({ keys: [jwk] }) };

/** @param {string | undefined} token @param {Record<string, unknown>} [overrides] */
const exchange = async (token, overrides = {}) =>
  handleDeployCredentials(
    new Request("https://engage-api.oneloneraven.com/v1/deploy-credentials", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.5", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }),
    brokerEnv(overrides),
    options,
  );

async function approvedRelease() {
  const { id } = await createRelease(env, {
    repo: REPO,
    product: "cl",
    environment: "production",
    sha: "abc123",
    ref: "v1.14.0",
    runId: 4242,
    callbackUrl: `https://api.github.com/repos/${REPO}/actions/runs/4242/deployment_protection_rule`,
    installationId: 7,
  });
  await decideRelease(env, id, "approved", "owner@example.test");
  return id;
}

/** @type {import("vitest").MockInstance} */
let mint;
const state = async (/** @type {string} */ id) =>
  (await env.DB.prepare("SELECT state FROM releases WHERE id = ?").bind(id).first())?.state;

beforeEach(async () => {
  clearJwksCache();
  await env.DB.exec("DELETE FROM releases");
  await env.DB.exec("DELETE FROM audit_events");
  await env.DB.prepare("UPDATE release_repos SET token_policy = ? WHERE repo = ?")
    .bind(JSON.stringify({ policies: POLICIES }), REPO)
    .run();
  mint = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ success: true, result: { value: "short-lived-token" } }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare("UPDATE release_repos SET token_policy = '{}' WHERE repo = ?").bind(REPO).run();
});

test("an approved release yields one short-lived token, scoped by the repo's policy, and is spent", async () => {
  const id = await approvedRelease();
  const response = await exchange(await oidc());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ token: "short-lived-token", expiresAt: "2026-11-25T12:55:00Z" });
  const [url, init] = mint.mock.calls[0];
  expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/tokens");
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer parent-token");
  expect(JSON.parse(String(init?.body))).toEqual({
    name: `Engage deploy: ${REPO} production run 4242`,
    policies: POLICIES,
    expires_on: "2026-11-25T12:55:00Z",
  });
  expect(await state(id)).toBe("spent");
  const audit = await env.DB.prepare(
    "SELECT action, target_id, detail FROM audit_events WHERE action = 'release.credential-minted'",
  ).first();
  expect(audit).toMatchObject({ action: "release.credential-minted", target_id: id });
  expect(String(audit?.detail)).not.toContain("short-lived-token");

  const again = await exchange(await oidc());
  expect(again.status).toBe(409);
  expect(mint).toHaveBeenCalledTimes(1);
});

test("claims that match no approved release get nothing", async () => {
  await approvedRelease();
  for (const claims of [{ sha: "other" }, { run_id: "4243" }, { environment: "infra" }]) {
    expect((await exchange(await oidc(claims))).status).toBe(403);
  }
  expect((await exchange(await oidc({ repository: "someone/else" }))).status).toBe(403);
  expect(mint).not.toHaveBeenCalled();
});

test("a pending release yields nothing until it's approved", async () => {
  await createRelease(env, {
    repo: REPO,
    product: "cl",
    environment: "production",
    sha: "abc123",
    ref: null,
    runId: 4242,
    callbackUrl: `https://api.github.com/repos/${REPO}/actions/runs/4242/deployment_protection_rule`,
    installationId: 7,
  });
  expect((await exchange(await oidc())).status).toBe(403);
});

test("a missing or invalid token is a 401 that says nothing more", async () => {
  await approvedRelease();
  for (const token of [undefined, "garbage", await oidc({ aud: "someone-else" })]) {
    const response = await exchange(token);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorised" });
  }
  expect(mint).not.toHaveBeenCalled();
});

test("a failed mint puts the release back, so a retry can still succeed", async () => {
  const id = await approvedRelease();
  mint.mockResolvedValueOnce(Response.json({ success: false }, { status: 500 }));
  expect((await exchange(await oidc())).status).toBe(502);
  expect(await state(id)).toBe("approved");
  expect((await exchange(await oidc())).status).toBe(200);
});

test("without a parent token, an account or a policy, the broker is not configured", async () => {
  await approvedRelease();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await exchange(await oidc(), { CLOUDFLARE_BROKER_TOKEN: undefined })).status).toBe(503);
  expect((await exchange(await oidc(), { CLOUDFLARE_ACCOUNT_ID: undefined })).status).toBe(503);
  await env.DB.prepare("UPDATE release_repos SET token_policy = '{}' WHERE repo = ?").bind(REPO).run();
  expect((await exchange(await oidc())).status).toBe(503);
  expect(error).toHaveBeenCalled();
  expect(mint).not.toHaveBeenCalled();
});

test("a caller over the rate limit is refused before anything else", async () => {
  const limiter = makeLimiter(false);
  expect((await exchange(await oidc(), { BROKER_LIMITER: limiter })).status).toBe(429);
  expect(limiter.keys).toEqual(["broker:203.0.113.5"]);
});
