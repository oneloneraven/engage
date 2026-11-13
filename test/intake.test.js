import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { handleSubmission } from "../src/intake/submissions.js";
import worker from "../src/worker.js";
import { makeCtx, makeEnv, makeLimiter, resetItems, stubFetch } from "./helpers.js";

const URL_ = "https://engage-api.oneloneraven.com/v1/submissions";
const SECRET_TEXT = "my-very-private-words";

/** @param {Record<string, unknown>} body @param {RequestInit & { headers?: Record<string, string> }} [init] */
const post = (body, init = {}) =>
  new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...init.headers },
    body: JSON.stringify(body),
  });

const webFeedback = (extra = {}) => ({
  product: "cl",
  kind: "feedback",
  source: "web",
  message: SECRET_TEXT,
  contactEmail: "someone@example.com",
  quoteConsent: true,
  credit: "initials",
  turnstileToken: "good",
  ...extra,
});

const appIssue = (extra = {}) => ({ product: "cl", kind: "issue", source: "app", message: SECRET_TEXT, ...extra });

async function submit(request, overrides = {}) {
  const ctx = makeCtx();
  const testEnv = makeEnv(overrides);
  const response = await handleSubmission(request, testEnv, ctx);
  await ctx.settled();
  return response;
}

const rows = async sql => (await env.DB.prepare(sql).all()).results;

beforeEach(async () => {
  await resetItems();
  await env.DB.exec("UPDATE products SET app_daily_cap = 50");
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("valid web feedback is stored and pinged without its content", async () => {
  const fetches = stubFetch();
  const response = await submit(post(webFeedback()));
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const { id } = await response.json();
  expect(id).toHaveLength(26);

  const [item] = await rows("SELECT * FROM items");
  expect(item).toMatchObject({
    id,
    product: "cl",
    kind: "feedback",
    source: "web",
    contact_email: "someone@example.com",
    quote_consent: 1,
    credit: "initials",
    junk: 0,
    suspected_spam: 0,
  });
  const [message] = await rows("SELECT * FROM messages");
  expect(message).toMatchObject({ item_id: id, direction: "in", body_text: SECRET_TEXT });

  expect(fetches.discord()).toHaveLength(1);
  const { content, allowed_mentions } = fetches.discord()[0].body;
  expect(content).toContain("New feedback");
  expect(content).toContain("Climbing Logbook");
  expect(content).toContain(`https://engage.oneloneraven.com/items/${id}`);
  expect(content).not.toContain(SECRET_TEXT);
  expect(content).not.toContain("someone@example.com");
  expect(allowed_mentions).toEqual({ parse: [] });
});

test("Turnstile is sent the secret, the token and the client IP", async () => {
  const fetches = stubFetch();
  await submit(post(webFeedback()));
  expect(fetches.turnstile()[0].body).toEqual({
    secret: "turnstile-secret",
    response: "good",
    remoteip: "203.0.113.7",
  });
});

test("a form-encoded web submission redirects to the product's thanks page", async () => {
  const fetches = stubFetch();
  const body = new URLSearchParams({
    product: "deaftly",
    kind: "feedback",
    source: "web",
    message: SECRET_TEXT,
    contactEmail: "",
    quoteConsent: "on",
    credit: "name",
    contactName: "Sam",
    "cf-turnstile-response": "good",
  });
  const response = await submit(
    new Request(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.7" },
      body,
    }),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe("https://deaftly.com/feedback/thanks/");
  const [item] = await rows("SELECT * FROM items");
  expect(item).toMatchObject({ product: "deaftly", contact_email: null, contact_name: "Sam", quote_consent: 1 });
  expect(fetches.discord()).toHaveLength(1);
});

test("a filled honeypot looks like success but stores and pings nothing", async () => {
  const fetches = stubFetch();
  const json = await submit(post(webFeedback({ hpx: "http://spam.example" })));
  expect(json.status).toBe(201);
  const form = await submit(
    new Request(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.7" },
      body: new URLSearchParams({ product: "cl", kind: "issue", source: "web", message: "x", hpx: "bot" }),
    }),
  );
  expect(form.status).toBe(303);
  expect(await rows("SELECT id FROM items")).toHaveLength(0);
  expect(fetches.discord()).toHaveLength(0);
  expect(fetches.turnstile()).toHaveLength(0);
});

test("a failed Turnstile check is a 400 that doesn't echo the message", async () => {
  const fetches = stubFetch();
  const response = await submit(post(webFeedback({ turnstileToken: "bad" })));
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain(SECRET_TEXT);
  expect(await rows("SELECT id FROM items")).toHaveLength(0);
  expect(fetches.discord()).toHaveLength(0);
});

test("a web submission without a token, or without a Turnstile secret, is refused", async () => {
  stubFetch();
  expect((await submit(post(webFeedback({ turnstileToken: undefined })))).status).toBe(400);
  expect((await submit(post(webFeedback()), { TURNSTILE_SECRET_KEY: undefined })).status).toBe(400);
  expect(await rows("SELECT id FROM items")).toHaveLength(0);
});

test("Turnstile being unreachable refuses the submission", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
  expect((await submit(post(webFeedback()))).status).toBe(400);
});

test("an app submission needs no Turnstile token", async () => {
  const fetches = stubFetch();
  const response = await submit(post(appIssue()));
  expect(response.status).toBe(201);
  expect(fetches.turnstile()).toHaveLength(0);
  expect(fetches.discord()[0].body.content).toContain("New issue");
});

test("an unknown product is a 400", async () => {
  stubFetch();
  const response = await submit(post(appIssue({ product: "nope" })));
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain(SECRET_TEXT);
});

test("5,000 emoji are accepted and 5,001 are refused", async () => {
  stubFetch();
  expect((await submit(post(appIssue({ message: "😀".repeat(5000) })))).status).toBe(201);
  const refused = await submit(post(appIssue({ message: "😀".repeat(5001) })));
  expect(refused.status).toBe(400);
  expect(await rows("SELECT id FROM items")).toHaveLength(1);
});

test("length is counted after trimming and CRLF normalisation", async () => {
  stubFetch();
  const message = `  ${"a\r\n".repeat(2499)}a  `;
  expect((await submit(post(appIssue({ message })))).status).toBe(201);
  const [stored] = await rows("SELECT body_text FROM messages");
  expect(stored.body_text).toBe(`${"a\n".repeat(2499)}a`);
});

test("an empty or whitespace-only message is refused", async () => {
  stubFetch();
  expect((await submit(post(appIssue({ message: "   \r\n " })))).status).toBe(400);
});

test("context drops unknown keys and refuses values over their maxLength", async () => {
  stubFetch();
  const ok = await submit(post(appIssue({ context: { errorRef: "ERR-1", surprise: "dropped" } })));
  expect(ok.status).toBe(201);
  const [item] = await rows("SELECT context FROM items");
  expect(JSON.parse(item.context)).toEqual({ errorRef: "ERR-1" });

  const tooLong = await submit(post(appIssue({ context: { errorRef: "x".repeat(65) } })));
  expect(tooLong.status).toBe(400);
  const wrongType = await submit(post(appIssue({ context: { errorRef: 7 } })));
  expect(wrongType.status).toBe(400);
});

test("quote consent and credit are kept only for feedback", async () => {
  stubFetch();
  await submit(post(appIssue({ quoteConsent: true, credit: "name" })));
  const [item] = await rows("SELECT quote_consent, credit FROM items");
  expect(item).toEqual({ quote_consent: 0, credit: null });
});

test("optional fields are stored and malformed ones are refused", async () => {
  stubFetch();
  const response = await submit(
    post(
      appIssue({
        sourcePage: "https://climbinglogbook.com/logbook",
        section: "logbook",
        appVersion: "1.2.3",
        accountRef: "acct-9",
        contactName: "Sam",
      }),
    ),
  );
  expect(response.status).toBe(201);
  const [item] = await rows("SELECT * FROM items");
  expect(item).toMatchObject({
    source_page: "https://climbinglogbook.com/logbook",
    section: "logbook",
    app_version: "1.2.3",
    account_ref: "acct-9",
    contact_name: "Sam",
  });
  for (const bad of [
    { appVersion: "v1" },
    { contactEmail: "not-an-email" },
    { sourcePage: "javascript:alert(1)" },
    { accountRef: "x".repeat(65) },
    { contactName: "x".repeat(101) },
    { kind: "email" },
    { source: "email" },
  ]) {
    expect((await submit(post(appIssue(bad)))).status, JSON.stringify(bad)).toBe(400);
  }
});

test("malformed bodies are 400s and an oversized one is a 413", async () => {
  stubFetch();
  const notJson = new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: "{nope",
  });
  expect((await submit(notJson)).status).toBe(400);
  const wrongType = new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": "text/plain", "CF-Connecting-IP": "203.0.113.7" },
    body: "hello",
  });
  expect((await submit(wrongType)).status).toBe(415);
  const huge = new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: JSON.stringify(appIssue({ message: "a".repeat(200_000) })),
  });
  expect((await submit(huge)).status).toBe(413);
});

test("app submissions over the daily cap are kept quietly as suspected spam", async () => {
  const fetches = stubFetch();
  await env.DB.exec("UPDATE products SET app_daily_cap = 2");
  for (let i = 0; i < 2; i++) expect((await submit(post(appIssue()))).status).toBe(201);
  expect(fetches.discord()).toHaveLength(2);

  const over = await submit(post(appIssue()));
  expect(over.status).toBe(201);
  expect(fetches.discord()).toHaveLength(2);
  const spam = await rows("SELECT suspected_spam FROM items ORDER BY id");
  expect(spam.map(row => row.suspected_spam)).toEqual([0, 0, 1]);
});

test("the daily cap ignores yesterday's items, other products and web submissions", async () => {
  const fetches = stubFetch();
  await env.DB.exec("UPDATE products SET app_daily_cap = 1");
  const old = "2020-01-01T00:00:00.000Z";
  const today = new Date().toISOString();
  const insert = env.DB.prepare(
    "INSERT INTO items (id, product, kind, source, created_at, last_activity_at) VALUES (?, ?, 'issue', ?, ?, ?)",
  );
  await env.DB.batch([
    insert.bind("OLD", "cl", "app", old, old),
    insert.bind("WEB", "cl", "web", today, today),
    insert.bind("OTHER", "deaftly", "app", today, today),
  ]);
  expect((await submit(post(appIssue()))).status).toBe(201);
  expect(fetches.discord()).toHaveLength(1);
});

test("a failed rate limit is a 429, keyed by source and IP", async () => {
  stubFetch();
  const web = makeLimiter(false);
  const app = makeLimiter();
  expect((await submit(post(webFeedback()), { INTAKE_WEB_LIMITER: web, INTAKE_APP_LIMITER: app })).status).toBe(429);
  expect(web.keys).toEqual(["web:203.0.113.7"]);
  expect(app.keys).toEqual([]);

  const web2 = makeLimiter();
  const app2 = makeLimiter(false);
  expect((await submit(post(appIssue()), { INTAKE_WEB_LIMITER: web2, INTAKE_APP_LIMITER: app2 })).status).toBe(429);
  expect(app2.keys).toEqual(["app:203.0.113.7"]);
  expect(await rows("SELECT id FROM items")).toHaveLength(0);
});

test("a Discord failure doesn't fail the submission and logs no content", async () => {
  stubFetch({ discordStatus: 500 });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const response = await submit(post(webFeedback()));
  expect(response.status).toBe(201);
  expect(warn).toHaveBeenCalled();
  const logged = warn.mock.calls.flat().join(" ");
  expect(logged).toContain("discord.failed");
  expect(logged).not.toContain(SECRET_TEXT);
  expect(logged).not.toContain("someone@example.com");
});

test("a missing Discord secret skips the ping and still stores the item", async () => {
  const fetches = stubFetch();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const response = await submit(post(appIssue()), { DISCORD_WEBHOOK_CL: undefined });
  expect(response.status).toBe(201);
  expect(fetches.discord()).toHaveLength(0);
  expect(await rows("SELECT id FROM items")).toHaveLength(1);
});

test("a preflight from a registered origin is allowed", async () => {
  const response = await submit(
    new Request(URL_, { method: "OPTIONS", headers: { Origin: "https://climbinglogbook.com" } }),
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://climbinglogbook.com");
  expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  expect(response.headers.get("Vary")).toContain("Origin");
});

test("a preflight from an unregistered origin gets no allow-origin header", async () => {
  const response = await submit(new Request(URL_, { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  const none = await submit(new Request(URL_, { method: "OPTIONS" }));
  expect(none.status).toBe(204);
  expect(none.headers.get("Access-Control-Allow-Origin")).toBeNull();
});

test("a response to a registered origin carries its allow-origin header, even an error", async () => {
  stubFetch();
  const ok = await submit(post(appIssue(), { headers: { Origin: "https://beta.climbinglogbook.com" } }));
  expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://beta.climbinglogbook.com");
  const bad = await submit(
    post(appIssue({ message: "" }), { headers: { Origin: "https://beta.climbinglogbook.com" } }),
  );
  expect(bad.status).toBe(400);
  expect(bad.headers.get("Access-Control-Allow-Origin")).toBe("https://beta.climbinglogbook.com");
  const evil = await submit(post(appIssue(), { headers: { Origin: "https://evil.example" } }));
  expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
});

test("the Worker routes the public host's intake and account paths, and 404s the rest", async () => {
  stubFetch();
  const testEnv = makeEnv({ PUBLIC_HOST: "engage-api.oneloneraven.com" });
  const ctx = makeCtx();
  const created = await worker.fetch(post(appIssue()), testEnv, ctx);
  expect(created.status).toBe(201);
  const preflight = await worker.fetch(
    new Request(URL_, { method: "OPTIONS", headers: { Origin: "https://climbinglogbook.com" } }),
    testEnv,
    ctx,
  );
  expect(preflight.status).toBe(204);
  const account = await worker.fetch(
    new Request("https://engage-api.oneloneraven.com/v1/accounts/cl/acct-1", { method: "DELETE" }),
    testEnv,
    ctx,
  );
  expect(account.status).toBe(403);
  for (const [method, path] of [
    ["GET", "/v1/submissions"],
    ["PUT", "/v1/submissions"],
    ["POST", "/v1/accounts/cl/acct-1"],
    ["DELETE", "/v1/accounts/cl"],
    ["DELETE", "/v1/accounts/cl/a/b"],
    ["POST", "/v1/other"],
  ]) {
    const response = await worker.fetch(
      new Request(`https://engage-api.oneloneraven.com${path}`, { method }),
      testEnv,
      ctx,
    );
    expect(response.status, `${method} ${path}`).toBe(404);
  }
  await ctx.settled();
});

test("the admin host does not serve intake", async () => {
  const testEnv = makeEnv({ APP_ENV: "e2e", ADMIN_HOST: "localhost", ADMIN_ACCESS_CHECK: "off" });
  const response = await worker.fetch(
    new Request("https://localhost/v1/submissions", { method: "POST", body: "{}" }),
    testEnv,
    makeCtx(),
  );
  expect(response.status).toBe(404);
});
