import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appJwt, clearInstallationTokens, createIssue, dispatch } from "../src/github/app.js";
import { issueDraft } from "../src/github/issue-draft.js";
import { handleGithubWebhook } from "../src/github/webhook.js";
import { hmacHex } from "../src/lib/hmac.js";
import worker from "../src/worker.js";
import { makeCtx, makeEnv, resetItems } from "./helpers.js";

const WEBHOOK_SECRET = "webhook-secret";
const T = "2026-03-01T00:00:00.000Z";
/** @type {string} */
let pem;
/** @type {CryptoKey} */
let publicKey;

beforeAll(async () => {
  const keys = /** @type {CryptoKeyPair} */ (
    await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )
  );
  publicKey = keys.publicKey;
  const der = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("pkcs8", keys.privateKey)));
  pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
});

beforeEach(async () => {
  await resetItems();
  clearInstallationTokens();
});
afterEach(() => vi.restoreAllMocks());

/** @param {Partial<Record<string, unknown>>} [fields] */
async function addItem(fields = {}) {
  const row = { id: "i1", kind: "issue", contact_email: "alex@example.org", issue_url: null, ...fields };
  await env.DB.prepare(
    "INSERT INTO items (id, product, kind, source, contact_email, issue_url, created_at, last_activity_at) VALUES (?, 'cl', ?, 'web', ?, ?, ?, ?)",
  )
    .bind(row.id, row.kind, row.contact_email, row.issue_url, T, T)
    .run();
}

function stubGithub() {
  /** @type {{ method: string, url: string, body: any }[]} */
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/orgs/oneloneraven/installation")) return Response.json({ id: 42 });
    if (url.endsWith("/app/installations/42/access_tokens")) {
      return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (url.endsWith("/repos/oneloneraven/climbing-logbook/issues")) {
      return Response.json({ number: 7, html_url: "https://github.com/oneloneraven/climbing-logbook/issues/7" });
    }
    if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
    return new Response("unexpected", { status: 599 });
  });
  return calls;
}

const githubEnv = () => makeEnv({ GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: pem });

describe("appJwt", () => {
  it("signs an RS256 JWT for the App that verifies with its public key", async () => {
    const jwt = await appJwt("123", pem, 1_800_000_000);
    const [header, payload, signature] = jwt.split(".");
    const decode = (/** @type {string} */ part) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(payload)).toEqual({ iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: "123" });
    const bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      bytes,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(ok).toBe(true);
  });
});

describe("issueDraft", () => {
  const product = { issueRepo: "oneloneraven/climbing-logbook" };
  const item = (/** @type {Partial<any>} */ overrides = {}) => ({
    kind: "issue",
    subject: null,
    appVersion: "1.2.3",
    sourcePage: "https://climbinglogbook.com/log",
    section: null,
    contactEmail: "alex@example.org",
    contactName: "Alex Example",
    accountRef: "acct-123",
    context: { reportedUsername: "someone-secret" },
    messages: [{ direction: "in", bodyText: "The map is blank\nsince yesterday ``` oops @raven" }],
    ...overrides,
  });

  it("targets the product's repo, titles from the first line and labels by kind", () => {
    const draft = issueDraft(item(), product);
    expect(draft.repo).toBe("oneloneraven/climbing-logbook");
    expect(draft.title).toBe("The map is blank");
    expect(draft.labels).toEqual(["bug"]);
    expect(issueDraft(item({ kind: "feedback" }), product).labels).toEqual(["enhancement"]);
  });

  it("truncates a long title at 70 characters with an ellipsis", () => {
    const draft = issueDraft(item({ messages: [{ direction: "in", bodyText: "x".repeat(90) }] }), product);
    expect([...draft.title]).toHaveLength(70);
    expect(draft.title.endsWith("…")).toBe(true);
  });

  it("fences the message with more backticks than it contains, so nothing renders or mentions anyone", () => {
    const draft = issueDraft(item(), product);
    expect(draft.body.startsWith("````text\n")).toBe(true);
    expect(draft.body).toContain("since yesterday ``` oops @raven\n````");
    expect(draft.body).toContain("App version: 1.2.3");
    expect(draft.body).toContain("Page or section: https://climbinglogbook.com/log");
  });

  it("never carries contact details, the account reference or context", () => {
    const { body, title } = issueDraft(item(), product);
    for (const secret of ["alex@example.org", "Alex Example", "acct-123", "someone-secret"]) {
      expect(body).not.toContain(secret);
      expect(title).not.toContain(secret);
    }
  });
});

describe("createIssue", () => {
  it("creates the issue in the registered repo and links it to the item", async () => {
    await addItem();
    const calls = stubGithub();
    const draft = { repo: "oneloneraven/climbing-logbook", title: "T", body: "B", labels: ["bug"] };
    expect(await createIssue(githubEnv(), "i1", draft, "owner@example.test")).toEqual({
      number: 7,
      url: "https://github.com/oneloneraven/climbing-logbook/issues/7",
    });
    const post = calls.find(call => call.url.endsWith("/issues"));
    expect(post?.body).toEqual({ title: "T", body: "B", labels: ["bug"] });
    const row = await env.DB.prepare("SELECT issue_number, issue_url FROM items WHERE id = 'i1'").first();
    expect(row).toEqual({ issue_number: 7, issue_url: "https://github.com/oneloneraven/climbing-logbook/issues/7" });
    const audit = await env.DB.prepare("SELECT action, detail FROM audit_events").first();
    expect(audit?.action).toBe("issue.created");
  });

  it("refuses a repo no product registers, before calling GitHub", async () => {
    await addItem();
    const calls = stubGithub();
    const draft = { repo: "someone/else", title: "T", body: "B", labels: [] };
    await expect(createIssue(githubEnv(), "i1", draft, "a")).rejects.toThrow("repo-not-registered");
    expect(calls).toHaveLength(0);
  });

  it("refuses a second issue for the same item", async () => {
    await addItem({ issue_url: "https://github.com/oneloneraven/climbing-logbook/issues/1" });
    stubGithub();
    const draft = { repo: "oneloneraven/climbing-logbook", title: "T", body: "B", labels: [] };
    await expect(createIssue(githubEnv(), "i1", draft, "a")).rejects.toThrow("issue-exists");
  });

  it("reuses the installation token", async () => {
    const calls = stubGithub();
    await dispatch(githubEnv(), "oneloneraven/deaftly-website", "testimonials-changed");
    await dispatch(githubEnv(), "oneloneraven/deaftly-website", "testimonials-changed");
    expect(calls.filter(call => call.url.endsWith("/access_tokens"))).toHaveLength(1);
    expect(calls.filter(call => call.url.endsWith("/dispatches")).map(call => call.body)).toEqual([
      { event_type: "testimonials-changed" },
      { event_type: "testimonials-changed" },
    ]);
  });
});

describe("webhook", () => {
  const URL_7 = "https://github.com/oneloneraven/climbing-logbook/issues/7";
  const hookEnv = () => makeEnv({ GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET });

  /** @param {string} state @param {{ event?: string, secret?: string }} [options] */
  async function deliver(state, { event = "issues", secret = WEBHOOK_SECRET } = {}) {
    const body = JSON.stringify({
      action: state === "closed" ? "closed" : "reopened",
      issue: { html_url: URL_7, state },
    });
    return handleGithubWebhook(
      new Request("https://engage-api.oneloneraven.com/v1/github/webhook", {
        method: "POST",
        body,
        headers: { "X-GitHub-Event": event, "X-Hub-Signature-256": `sha256=${await hmacHex(secret, body)}` },
      }),
      hookEnv(),
    );
  }
  const owed = async () =>
    (await env.DB.prepare("SELECT reply_owed_at FROM items WHERE id = 'i1'").first())?.reply_owed_at ?? null;

  it("refuses a bad signature", async () => {
    await addItem({ issue_url: URL_7 });
    expect((await deliver("closed", { secret: "wrong" })).status).toBe(401);
    expect(await owed()).toBeNull();
  });

  it("flags reply owed once when the linked issue closes, however often it's delivered", async () => {
    await addItem({ issue_url: URL_7 });
    expect((await deliver("closed")).status).toBe(204);
    const first = await owed();
    expect(first).not.toBeNull();
    await deliver("closed");
    expect(await owed()).toBe(first);
  });

  it("clears it on reopen, and the last state delivered wins", async () => {
    await addItem({ issue_url: URL_7 });
    await deliver("open");
    await deliver("closed");
    expect(await owed()).not.toBeNull();
    await deliver("open");
    expect(await owed()).toBeNull();
  });

  it("never flags an item that has no contact email", async () => {
    await addItem({ issue_url: URL_7, contact_email: null });
    await deliver("closed");
    expect(await owed()).toBeNull();
  });

  it("ignores unrelated issues and other events", async () => {
    await addItem({ issue_url: "https://github.com/oneloneraven/climbing-logbook/issues/8" });
    expect((await deliver("closed")).status).toBe(204);
    expect((await deliver("closed", { event: "ping" })).status).toBe(204);
    expect(await owed()).toBeNull();
  });

  it("is reachable on the public host only", async () => {
    const request = (/** @type {string} */ host) =>
      new Request(`https://${host}/v1/github/webhook`, { method: "POST", body: "{}" });
    const local = hookEnv();
    expect((await worker.fetch(request("engage-api.oneloneraven.com"), local, makeCtx())).status).toBe(401);
    expect([403, 404]).toContain((await worker.fetch(request("engage.oneloneraven.com"), local, makeCtx())).status);
  });
});
