import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { handleGithubWebhook } from "../src/github/webhook.js";
import { hmacHex } from "../src/lib/hmac.js";
import { DISCORD_URL, makeEnv } from "./helpers.js";

const SECRET = "webhook-secret";
const CALLBACK =
  "https://api.github.com/repos/oneloneraven/climbing-logbook/actions/runs/4242/deployment_protection_rule";

/** @param {Record<string, unknown>} [overrides] */
const payload = (overrides = {}) => ({
  action: "requested",
  environment: "production",
  deployment_callback_url: CALLBACK,
  deployment: { sha: "abc123", ref: "v1.14.0" },
  repository: { full_name: "oneloneraven/climbing-logbook" },
  installation: { id: 7 },
  ...overrides,
});

/** @param {unknown} body @param {{ signed?: boolean }} [options] */
async function deliver(body, { signed = true } = {}) {
  const text = JSON.stringify(body);
  return handleGithubWebhook(
    new Request("https://engage-api.oneloneraven.com/v1/github/webhook", {
      method: "POST",
      body: text,
      headers: {
        "X-GitHub-Event": "deployment_protection_rule",
        "X-Hub-Signature-256": signed ? `sha256=${await hmacHex(SECRET, text)}` : "sha256=nope",
      },
    }),
    makeEnv({ GITHUB_WEBHOOK_SECRET: SECRET }),
  );
}

const releases = async () =>
  (
    await env.DB.prepare(
      "SELECT id, repo, product, environment, sha, ref, run_id, installation_id, state FROM releases",
    ).all()
  ).results;

/** @type {import("vitest").MockInstance} */
let fetchSpy;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM releases");
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(() => vi.restoreAllMocks());

test("a gated repository and environment become one pending release and one content-free ping", async () => {
  expect((await deliver(payload())).status).toBe(204);
  const [release] = await releases();
  expect(release).toMatchObject({
    repo: "oneloneraven/climbing-logbook",
    product: "cl",
    environment: "production",
    sha: "abc123",
    ref: "v1.14.0",
    run_id: 4242,
    installation_id: 7,
    state: "pending",
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0];
  expect(url).toBe(DISCORD_URL);
  expect(JSON.parse(String(init?.body)).content).toBe(
    `**Release waiting** · Climbing Logbook\nhttps://engage.oneloneraven.com/releases/${release.id}`,
  );
});

test("a redelivery stores nothing new and doesn't ping again", async () => {
  await deliver(payload());
  await deliver(payload());
  expect(await releases()).toHaveLength(1);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("an ungated repository or environment is acknowledged and ignored", async () => {
  for (const body of [
    payload({ repository: { full_name: "someone/else" } }),
    payload({ environment: "preview" }),
    payload({ repository: { full_name: "oneloneraven/deaftly" } }),
    payload({ action: "completed" }),
  ])
    expect((await deliver(body)).status).toBe(204);
  expect(await releases()).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a gated request without a usable callback, commit or installation is a 400", async () => {
  for (const body of [
    payload({ deployment_callback_url: undefined }),
    payload({
      deployment_callback_url: "https://api.github.com/repos/a/b/actions/runs/abc/deployment_protection_rule",
    }),
    payload({ deployment_callback_url: "https://evil.example/repos/a/b/actions/runs/1/deployment_protection_rule" }),
    payload({ deployment: { ref: "v1" } }),
    payload({ installation: {} }),
  ])
    expect((await deliver(body)).status).toBe(400);
  expect(await releases()).toEqual([]);
});

test("an unsigned request is refused before anything is stored", async () => {
  expect((await deliver(payload(), { signed: false })).status).toBe(401);
  expect(await releases()).toEqual([]);
});
