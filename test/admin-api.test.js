import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { clearInstallationTokens } from "../src/github/app.js";
import { makeReplyAddress } from "../src/email/reply-address.js";
import worker from "../src/worker.js";
import { makeBucket, makeCtx, makeEnv, resetItems } from "./helpers.js";

const T = "2026-03-01T00:00:00.000Z";
const ACTOR = "dev@localhost";
const BODY = "Great app. It works offline";
const HOST = "https://localhost";

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

beforeEach(async () => {
  await resetItems();
  await baseEnv.DB.exec("DELETE FROM testimonials");
  await baseEnv.DB.exec("DELETE FROM blocklist");
  await baseEnv.DB.exec("DELETE FROM audit_events");
  await baseEnv.DB.exec("UPDATE products SET testimonials_enabled = 1");
  clearInstallationTokens();
});
afterEach(() => vi.restoreAllMocks());

function fakeEmail({ fails = false } = {}) {
  /** @type {any[]} */
  const sent = [];
  return {
    sent,
    send: async (/** @type {any} */ message) => {
      if (fails) throw Object.assign(new Error("nope"), { code: "E_DELIVERY_FAILED" });
      sent.push(message);
      return { messageId: "<out@example>" };
    },
  };
}

/** @param {Record<string, unknown>} [overrides] */
function adminEnv(overrides = {}) {
  return makeEnv({
    APP_ENV: "e2e",
    ADMIN_HOST: "localhost",
    ADMIN_ACCESS_CHECK: "off",
    ASSETS: { fetch: async () => new Response("asset") },
    EMAIL: fakeEmail(),
    ATTACHMENTS: makeBucket(),
    REPLY_ADDRESS_SECRET: "reply-secret",
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: pem,
    ...overrides,
  });
}

/**
 * @param {string} method
 * @param {string} path
 * @param {{ body?: unknown, raw?: string, type?: string | null, env?: any }} [options]
 */
async function call(method, path, { body, raw, type = "application/json", env = adminEnv() } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const headers = new Headers();
  if (payload !== undefined && type) headers.set("Content-Type", type);
  const ctx = makeCtx();
  const response = await worker.fetch(new Request(`${HOST}${path}`, { method, headers, body: payload }), env, ctx);
  await ctx.settled();
  return response;
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} [fields]
 */
async function seed(id, fields = {}) {
  const row = {
    product: "cl",
    kind: "feedback",
    source: "web",
    subject: null,
    contact_email: "alex@example.org",
    contact_name: "Alex Smith",
    quote_consent: 1,
    credit: "name",
    read_at: null,
    issue_url: null,
    created_at: T,
    last_activity_at: T,
    ...fields,
  };
  const columns = ["id", ...Object.keys(row)];
  await baseEnv.DB.prepare(`INSERT INTO items (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .bind(id, ...Object.values(row))
    .run();
  await baseEnv.DB.prepare(
    "INSERT INTO messages (id, item_id, direction, from_addr, body_text, rfc_message_id, created_at) VALUES (?, ?, 'in', 'alex@example.org', ?, '<in@example>', ?)",
  )
    .bind(`m-${id}`, id, BODY, T)
    .run();
}

async function audit() {
  const { results } = await baseEnv.DB.prepare("SELECT actor, action, target_id, detail FROM audit_events").all();
  return results;
}

function stubGithub() {
  /** @type {{ method: string, url: string, body: any }[]} */
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/installation")) return Response.json({ id: 42 });
    if (url.endsWith("/access_tokens")) {
      return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (url.endsWith("/climbing-logbook/issues")) {
      return Response.json({ number: 7, html_url: "https://github.com/oneloneraven/climbing-logbook/issues/7" });
    }
    if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
    return new Response("unexpected", { status: 599 });
  });
  return calls;
}

describe("routing", () => {
  test("unknown API routes are 404 and a wrong method on a known path is 405", async () => {
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("GET", "/api/items/a/nope")).status).toBe(404);
    const wrong = await call("PUT", "/api/items");
    expect(wrong.status).toBe(405);
    expect(await wrong.json()).toEqual({ error: "method-not-allowed" });
    expect((await call("GET", "/api/blocklist")).status).toBe(405);
    expect((await call("POST", "/api/counts")).status).toBe(405);
  });

  test("health, the SPA and the public paths behave as before", async () => {
    expect((await call("GET", "/api/health")).status).toBe(200);
    expect(await (await call("GET", "/inbox")).text()).toBe("asset");
    expect((await call("GET", "/v1/testimonials/cl")).status).toBe(404);
  });

  test("the guard still refuses the API without an identity", async () => {
    const guarded = adminEnv({ APP_ENV: "production", ADMIN_ACCESS_CHECK: "on" });
    expect((await call("GET", "/api/items", { env: guarded })).status).toBe(403);
  });

  test("responses are JSON and uncached", async () => {
    const response = await call("GET", "/api/counts");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });
});

describe("request bodies", () => {
  test("a non-JSON content type, malformed JSON, or a non-object body is 400", async () => {
    await seed("a");
    const cases = [
      { raw: '{"read":true}', type: "text/plain" },
      { raw: '{"read":true}', type: null },
      { raw: "{nope", type: "application/json" },
      { raw: "[1]", type: "application/json" },
    ];
    for (const options of cases) {
      const response = await call("PATCH", "/api/items/a", options);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "bad-request" });
    }
    expect((await call("POST", "/api/blocklist", { raw: "x=1", type: "text/plain" })).status).toBe(400);
    expect(await audit()).toEqual([]);
  });

  test("a validation failure is 400 and never echoes the input", async () => {
    await seed("a");
    const bad = await call("POST", "/api/items/a/replies", { body: { text: "   ", note: "private-note" } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).not.toContain("private-note");
  });
});

describe("GET /api/items", () => {
  test("lists with filters and a cursor, and rejects bad filters", async () => {
    await seed("a", { last_activity_at: "2026-03-01T00:00:00.000Z" });
    await seed("b", { last_activity_at: "2026-03-02T00:00:00.000Z", kind: "issue" });
    const all = await (await call("GET", "/api/items")).json();
    expect(all.items.map((/** @type {any} */ i) => i.id)).toEqual(["b", "a"]);
    const issues = await (await call("GET", "/api/items?kind=issue&state=new")).json();
    expect(issues.items.map((/** @type {any} */ i) => i.id)).toEqual(["b"]);
    const page = await (await call("GET", "/api/items?limit=1")).json();
    expect(page.items).toHaveLength(1);
    const second = await (await call("GET", `/api/items?limit=1&cursor=${encodeURIComponent(page.next)}`)).json();
    expect(second.items[0].id).toBe("a");
    expect((await call("GET", "/api/items?cursor=garbage")).status).toBe(400);
    expect((await call("GET", "/api/items?state=weird")).status).toBe(400);
    expect((await call("GET", "/api/items?limit=abc")).status).toBe(400);
    expect((await call("GET", "/api/items?hasIssue=maybe")).status).toBe(400);
  });
});

describe("GET /api/items/:id", () => {
  test("returns the item and marks an unread one read, audited once", async () => {
    await seed("a");
    const first = await call("GET", "/api/items/a");
    expect(first.status).toBe(200);
    const item = await first.json();
    expect(item.messages[0].bodyText).toBe(BODY);
    expect(item.readAt).not.toBeNull();
    expect(await audit()).toEqual([{ actor: ACTOR, action: "item.read", target_id: "a", detail: "{}" }]);
    await call("GET", "/api/items/a");
    expect(await audit()).toHaveLength(1);
  });

  test("an unknown id is 404 and writes nothing", async () => {
    expect((await call("GET", "/api/items/missing")).status).toBe(404);
    expect(await audit()).toEqual([]);
  });
});

describe("PATCH /api/items/:id", () => {
  test("sets flags and audits under the Access identity", async () => {
    await seed("a");
    const response = await call("PATCH", "/api/items/a", { body: { starred: true, archived: true } });
    expect(response.status).toBe(200);
    const item = await response.json();
    expect(item.starred).toBe(true);
    expect(item.archivedAt).not.toBeNull();
    expect(item.readAt).toBeNull();
    const rows = await audit();
    expect(rows.map(row => row.action).sort()).toEqual(["item.archived", "item.starred"]);
    expect(rows.every(row => row.actor === ACTOR)).toBe(true);
  });

  test("refuses unknown fields, replyOwed true and wrong types, and 404s an unknown id", async () => {
    await seed("a");
    expect((await call("PATCH", "/api/items/a", { body: { replyOwed: true } })).status).toBe(400);
    expect((await call("PATCH", "/api/items/a", { body: { starred: "yes" } })).status).toBe(400);
    expect((await call("PATCH", "/api/items/a", { body: { id: "x" } })).status).toBe(400);
    expect((await call("PATCH", "/api/items/missing", { body: { read: true } })).status).toBe(404);
    expect(await audit()).toEqual([]);
  });
});

describe("DELETE /api/items/:id", () => {
  test("deletes the item with its R2 objects, withdrawing its testimonials, and audits", async () => {
    await seed("a");
    const bucket = makeBucket();
    await bucket.put("k1", new ArrayBuffer(1), {});
    await baseEnv.DB.prepare(
      "INSERT INTO attachments (id, item_id, message_id, r2_key, filename, content_type, size) VALUES ('att', 'a', 'm-a', 'k1', 'a.txt', 'text/plain', 1)",
    ).run();
    const response = await call("DELETE", "/api/items/a", { env: adminEnv({ ATTACHMENTS: bucket }) });
    expect(response.status).toBe(200);
    expect(bucket.objects.size).toBe(0);
    expect(await baseEnv.DB.prepare("SELECT 1 FROM items WHERE id = 'a'").first()).toBeNull();
    expect(await audit()).toEqual([{ actor: ACTOR, action: "item.deleted", target_id: "a", detail: "{}" }]);
  });

  test("an unknown id is 404", async () => {
    expect((await call("DELETE", "/api/items/missing")).status).toBe(404);
  });
});

describe("POST /api/items/:id/replies", () => {
  test("sends the reply from the product address and audits", async () => {
    await seed("a", { subject: "Hello" });
    const email = fakeEmail();
    const response = await call("POST", "/api/items/a/replies", {
      body: { text: "  Thanks!  " },
      env: adminEnv({ EMAIL: email }),
    });
    expect(response.status).toBe(201);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe("alex@example.org");
    expect(email.sent[0].subject).toBe("Re: Hello");
    expect(email.sent[0].text).toBe("Thanks!");
    expect(email.sent[0].replyTo).toBe(
      await makeReplyAddress("a", email.sent[0].from.email.split("@")[1], "reply-secret"),
    );
    expect(await audit()).toEqual([{ actor: ACTOR, action: "reply.sent", target_id: "a", detail: expect.any(String) }]);
  });

  test("an item without a contact email is 409 no-contact", async () => {
    await seed("a", { contact_email: null });
    const response = await call("POST", "/api/items/a/replies", { body: { text: "Hi" } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "no-contact" });
  });

  test("maps a missing secret and a send failure to 502, and an unknown item to 404", async () => {
    await seed("a");
    const noSecret = await call("POST", "/api/items/a/replies", {
      body: { text: "Hi" },
      env: adminEnv({ REPLY_ADDRESS_SECRET: undefined }),
    });
    expect(noSecret.status).toBe(502);
    expect(await noSecret.json()).toEqual({ error: "reply-secret-missing" });
    const failing = await call("POST", "/api/items/a/replies", {
      body: { text: "Hi" },
      env: adminEnv({ EMAIL: fakeEmail({ fails: true }) }),
    });
    expect(failing.status).toBe(502);
    expect(await failing.json()).toEqual({ error: "send-failed" });
    expect((await call("POST", "/api/items/missing/replies", { body: { text: "Hi" } })).status).toBe(404);
  });

  test("text must be 1 to 10,000 characters after trimming", async () => {
    await seed("a");
    expect((await call("POST", "/api/items/a/replies", { body: { text: "" } })).status).toBe(400);
    expect((await call("POST", "/api/items/a/replies", { body: { text: 5 } })).status).toBe(400);
    expect((await call("POST", "/api/items/a/replies", { body: { text: "x".repeat(10_001) } })).status).toBe(400);
    expect((await call("POST", "/api/items/a/replies", { body: { text: "😍".repeat(10_000) } })).status).toBe(201);
  });
});

describe("issue draft and issue creation", () => {
  test("GET issue-draft returns the draft for the item's product", async () => {
    await seed("a", { kind: "issue" });
    const response = await call("GET", "/api/items/a/issue-draft");
    expect(response.status).toBe(200);
    const draft = await response.json();
    expect(draft.repo).toBe("oneloneraven/climbing-logbook");
    expect(draft.labels).toEqual(["bug"]);
    expect(draft.body).not.toContain("alex@example.org");
    expect((await call("GET", "/api/items/missing/issue-draft")).status).toBe(404);
  });

  test("POST issue creates it, stores the link and audits", async () => {
    await seed("a");
    const calls = stubGithub();
    const draft = { repo: "oneloneraven/climbing-logbook", title: "A bug", body: "Details", labels: ["bug"] };
    const response = await call("POST", "/api/items/a/issue", { body: draft });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      number: 7,
      url: "https://github.com/oneloneraven/climbing-logbook/issues/7",
    });
    expect(calls.some(c => c.url.endsWith("/climbing-logbook/issues") && c.body.title === "A bug")).toBe(true);
    expect(await audit()).toEqual([
      { actor: ACTOR, action: "issue.created", target_id: "a", detail: expect.any(String) },
    ]);
  });

  test("maps issue-exists to 409, an unregistered repo to 400, an unconfigured App to 502 and GitHub errors to 502", async () => {
    await seed("a");
    await seed("b", { issue_url: "https://github.com/x/y/issues/1" });
    stubGithub();
    const draft = { repo: "oneloneraven/climbing-logbook", title: "T", body: "B", labels: [] };
    const exists = await call("POST", "/api/items/b/issue", { body: draft });
    expect(exists.status).toBe(409);
    expect(await exists.json()).toEqual({ error: "issue-exists" });
    const unregistered = await call("POST", "/api/items/a/issue", { body: { ...draft, repo: "someone/else" } });
    expect(unregistered.status).toBe(400);
    expect(await unregistered.json()).toEqual({ error: "repo-not-registered" });
    const unconfigured = await call("POST", "/api/items/a/issue", {
      body: draft,
      env: adminEnv({ GITHUB_APP_ID: undefined }),
    });
    expect(unconfigured.status).toBe(502);
    expect(await unconfigured.json()).toEqual({ error: "github-app-not-configured" });
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 403 }));
    const upstream = await call("POST", "/api/items/a/issue", { body: draft });
    expect(upstream.status).toBe(502);
    expect(await upstream.json()).toEqual({ error: "github-403" });
    expect((await call("POST", "/api/items/missing/issue", { body: draft })).status).toBe(404);
  });

  test("validates repo, title, body and labels", async () => {
    await seed("a");
    const draft = { repo: "oneloneraven/climbing-logbook", title: "T", body: "B", labels: [] };
    for (const bad of [
      { ...draft, title: "" },
      { ...draft, title: "x".repeat(257) },
      { ...draft, body: "" },
      { ...draft, body: "x".repeat(65_001) },
      { ...draft, labels: Array.from({ length: 11 }, () => "l") },
      { ...draft, labels: [1] },
      { ...draft, repo: undefined },
    ]) {
      expect((await call("POST", "/api/items/a/issue", { body: bad })).status).toBe(400);
    }
  });
});

describe("testimonials", () => {
  test("creates an excerpt, then approves and withdraws it, each audited", async () => {
    await seed("a");
    stubGithub();
    const created = await call("POST", "/api/items/a/testimonials", { body: { excerpt: "Great app" } });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await call("POST", `/api/testimonials/${id}/approve`)).status).toBe(200);
    expect((await call("POST", `/api/testimonials/${id}/withdraw`)).status).toBe(200);
    const rows = await audit();
    expect(rows.map(row => row.action)).toEqual([
      "testimonial.created",
      "testimonial.approved",
      "testimonial.withdrawn",
    ]);
    expect(rows.every(row => row.actor === ACTOR)).toBe(true);
  });

  test("refuses without consent or when not faithful (409), and bad bodies (400)", async () => {
    await seed("a");
    await seed("b", { quote_consent: 0 });
    const unfaithful = await call("POST", "/api/items/a/testimonials", { body: { excerpt: "Terrible app" } });
    expect(unfaithful.status).toBe(409);
    expect(await unfaithful.json()).toEqual({ error: "not-faithful" });
    const noConsent = await call("POST", "/api/items/b/testimonials", { body: { excerpt: "Great app" } });
    expect(noConsent.status).toBe(409);
    expect(await noConsent.json()).toEqual({ error: "no-consent" });
    expect((await call("POST", "/api/items/a/testimonials", { body: { excerpt: "" } })).status).toBe(400);
    expect((await call("POST", "/api/items/a/testimonials", { body: { excerpt: "x".repeat(2001) } })).status).toBe(400);
    expect((await call("POST", "/api/items/missing/testimonials", { body: { excerpt: "Great app" } })).status).toBe(
      404,
    );
  });

  test("approve and withdraw of an unknown testimonial are 404", async () => {
    expect((await call("POST", "/api/testimonials/missing/approve")).status).toBe(404);
    expect((await call("POST", "/api/testimonials/missing/withdraw")).status).toBe(404);
    expect((await call("GET", "/api/testimonials/missing/approve")).status).toBe(405);
  });
});

describe("POST /api/blocklist", () => {
  test("adds an address or a domain, audits without the pattern, and is idempotent", async () => {
    const first = await call("POST", "/api/blocklist", { body: { pattern: "spam@example.org" } });
    expect(first.status).toBe(200);
    expect((await call("POST", "/api/blocklist", { body: { pattern: "@spam.example" } })).status).toBe(200);
    expect((await call("POST", "/api/blocklist", { body: { pattern: "spam@example.org" } })).status).toBe(200);
    const { results } = await baseEnv.DB.prepare("SELECT pattern FROM blocklist ORDER BY pattern").all();
    expect(results.map(row => row.pattern)).toEqual(["@spam.example", "spam@example.org"]);
    const rows = await audit();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.actor === ACTOR && row.action === "blocklist.added" && row.detail === "{}")).toBe(
      true,
    );
    expect(JSON.stringify(rows)).not.toContain("spam");
  });

  test("rejects uppercase, malformed and over-long patterns", async () => {
    for (const pattern of [
      "Spam@example.org",
      "nodomain",
      "@",
      "@nodot",
      "a b@example.org",
      `${"a".repeat(250)}@e.org`,
      5,
    ]) {
      expect((await call("POST", "/api/blocklist", { body: { pattern } })).status).toBe(400);
    }
    expect(await audit()).toEqual([]);
  });
});

describe("GET /api/counts", () => {
  test("returns the inbox counts", async () => {
    await seed("a");
    const counts = await (await call("GET", "/api/counts")).json();
    expect(counts.new).toBe(1);
    expect(counts.byProduct.cl.new).toBe(1);
  });
});

describe("GET /api/items/:id/attachments/:attachmentId", () => {
  async function seedAttachment(bucket = makeBucket()) {
    await seed("a");
    await seed("b");
    await bucket.put("a/att1", new TextEncoder().encode("hello").buffer, {});
    await baseEnv.DB.prepare(
      "INSERT INTO attachments (id, item_id, message_id, r2_key, filename, content_type, size) VALUES ('att1', 'a', 'm-a', 'a/att1', ?, 'text/plain', 5)",
    )
      .bind('../we"ird\r\nname.txt')
      .run();
    return adminEnv({ ATTACHMENTS: bucket });
  }

  test("streams the object as an attachment with its content type and a sanitised filename", async () => {
    const env = await seedAttachment();
    const response = await call("GET", "/api/items/a/attachments/att1", { env });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9._ -]+"$/);
    expect(disposition).not.toContain("/");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("another item's attachment, an unknown attachment and a missing object are 404", async () => {
    const env = await seedAttachment();
    expect((await call("GET", "/api/items/b/attachments/att1", { env })).status).toBe(404);
    expect((await call("GET", "/api/items/a/attachments/nope", { env })).status).toBe(404);
    env.ATTACHMENTS.objects.clear();
    expect((await call("GET", "/api/items/a/attachments/att1", { env })).status).toBe(404);
  });

  test("a stored content type that isn't a media type is served as octet-stream", async () => {
    const env = await seedAttachment();
    await baseEnv.DB.exec("UPDATE attachments SET content_type = 'not a type'");
    const response = await call("GET", "/api/items/a/attachments/att1", { env });
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

describe("unexpected errors", () => {
  test("are 500 with no detail, logged by error name only", async () => {
    await seed("a", { subject: "private subject" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = adminEnv({
      DB: new Proxy(baseEnv.DB, {
        get(target, key) {
          if (key === "prepare") {
            return (/** @type {string} */ sql) => {
              if (sql.startsWith("SELECT *, (SELECT COUNT")) throw new TypeError("private subject exploded");
              return target.prepare(sql);
            };
          }
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
    const response = await call("GET", "/api/items/a", { env: broken });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
    const output = JSON.stringify(logged.mock.calls);
    expect(output).toContain("TypeError");
    expect(output).not.toContain("private subject");
  });
});
