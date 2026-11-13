import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { clearInstallationTokens } from "../src/github/app.js";
import worker from "../src/worker.js";
import {
  approve,
  createExcerpt,
  deleteItemWithTestimonials,
  publicFeed,
  withdraw,
  withdrawAllForItem,
} from "../src/testimonials/testimonials.js";
import { makeBucket, makeCtx, makeEnv, resetItems } from "./helpers.js";

const ACTOR = "raven@example.com";
const T = "2026-03-01T00:00:00.000Z";
const BODY = "I love it. Also, it works offline 😍";

/** @type {string} */
let pem;

beforeEach(async () => {
  await resetItems();
  await baseEnv.DB.exec("DELETE FROM testimonials");
  await baseEnv.DB.exec("DELETE FROM audit_events");
  await baseEnv.DB.exec("UPDATE products SET testimonials_enabled = 1");
  clearInstallationTokens();
  if (!pem) {
    const keys = /** @type {CryptoKeyPair} */ (
      await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["sign", "verify"],
      )
    );
    const der = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("pkcs8", keys.privateKey)));
    pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
  }
});
afterEach(() => vi.restoreAllMocks());

const testEnv = () =>
  makeEnv({ GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: pem, PUBLIC_HOST: "engage-api.oneloneraven.com" });

/**
 * @param {string} id
 * @param {Record<string, unknown>} [fields]
 */
async function seedItem(id, fields = {}) {
  const row = {
    product: "deaftly",
    kind: "feedback",
    source: "web",
    contact_name: "Jamie Smith",
    quote_consent: 1,
    credit: "name",
    ...fields,
  };
  await baseEnv.DB.prepare(
    "INSERT INTO items (id, product, kind, source, contact_name, quote_consent, credit, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, row.product, row.kind, row.source, row.contact_name, row.quote_consent, row.credit, T, T)
    .run();
  await baseEnv.DB.prepare(
    "INSERT INTO messages (id, item_id, direction, from_addr, body_text, created_at) VALUES (?, ?, 'in', 'a@example.org', ?, ?)",
  )
    .bind(`m-${id}`, id, BODY, T)
    .run();
}

/**
 * @param {string} id
 * @param {string} itemId
 * @param {Record<string, unknown>} [fields]
 */
async function seedQuote(id, itemId, fields = {}) {
  const row = {
    product: "deaftly",
    excerpt: "I love it.",
    attribution: "Jamie Smith",
    approved_at: null,
    withdrawn_at: null,
    ...fields,
  };
  await baseEnv.DB.prepare(
    "INSERT INTO testimonials (id, item_id, product, excerpt, attribution, approved_at, withdrawn_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, itemId, row.product, row.excerpt, row.attribution, row.approved_at, row.withdrawn_at, T)
    .run();
}

/** @param {{ dispatchStatus?: number }} [options] */
function stubGithub({ dispatchStatus = 204 } = {}) {
  /** @type {{ url: string, body: any }[]} */
  const dispatches = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orgs/oneloneraven/installation")) return Response.json({ id: 42 });
    if (url.endsWith("/app/installations/42/access_tokens")) {
      return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (url.endsWith("/dispatches")) {
      dispatches.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: dispatchStatus });
    }
    return new Response("unexpected", { status: 599 });
  });
  return dispatches;
}

async function quote(id = "q1") {
  return baseEnv.DB.prepare("SELECT * FROM testimonials WHERE id = ?").bind(id).first();
}

async function audits() {
  const { results } = await baseEnv.DB.prepare("SELECT * FROM audit_events ORDER BY id").all();
  return results;
}

test("createExcerpt stores a faithful excerpt with attribution and audits without text", async () => {
  await seedItem("i1");
  const { id } = await createExcerpt(testEnv(), "i1", "  I love it … works offline 😍  ", ACTOR);
  const row = await quote(id);
  expect(row).toMatchObject({
    item_id: "i1",
    product: "deaftly",
    excerpt: "I love it … works offline 😍",
    attribution: "Jamie Smith",
    approved_at: null,
    withdrawn_at: null,
  });
  const [event] = await audits();
  expect(event).toMatchObject({ actor: ACTOR, action: "testimonial.created", target_id: id });
  expect(JSON.parse(String(event.detail))).toEqual({ testimonialId: id });
  expect(JSON.stringify(event)).not.toContain("love");
});

test("createExcerpt refuses an excerpt that is not faithful", async () => {
  await seedItem("i1");
  await expect(createExcerpt(testEnv(), "i1", "I adore it", ACTOR)).rejects.toThrow("not-faithful");
  await expect(createExcerpt(testEnv(), "i1", "works offline … I love it", ACTOR)).rejects.toThrow("not-faithful");
  expect((await baseEnv.DB.prepare("SELECT COUNT(*) AS n FROM testimonials").first())?.n).toBe(0);
});

test("createExcerpt refuses without consent or for another kind", async () => {
  await seedItem("i1", { quote_consent: 0 });
  await seedItem("i2", { kind: "issue" });
  await expect(createExcerpt(testEnv(), "i1", "I love it", ACTOR)).rejects.toThrow("no-consent");
  await expect(createExcerpt(testEnv(), "i2", "I love it", ACTOR)).rejects.toThrow("no-consent");
});

test("createExcerpt throws not-found for an unknown item", async () => {
  await expect(createExcerpt(testEnv(), "nope", "I love it", ACTOR)).rejects.toThrow("not-found");
});

test.each([
  ["name", "Jamie Smith", "Jamie Smith"],
  ["name", null, "Anonymous"],
  ["name", "  ", "Anonymous"],
  ["initials", "Jamie Smith", "J. S."],
  ["initials", "jamie", "J."],
  ["initials", "Jamie Q Smith", "J. Q."],
  ["initials", "Élodie Martin", "É. M."],
  ["anonymous", "Jamie Smith", "Anonymous"],
])("attribution for credit %s and name %j is %s", async (credit, contactName, expected) => {
  await seedItem("i1", { credit, contact_name: contactName });
  const { id } = await createExcerpt(testEnv(), "i1", "I love it", ACTOR);
  expect((await quote(id))?.attribution).toBe(expected);
});

test("approve sets approved_at, clears withdrawn_at, audits and dispatches the site rebuild", async () => {
  await seedItem("i1");
  await seedQuote("q1", "i1", { withdrawn_at: T });
  const dispatches = stubGithub();
  await approve(testEnv(), "q1", ACTOR);
  const row = await quote();
  expect(row?.approved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(row?.withdrawn_at).toBeNull();
  expect((await audits()).map(event => event.action)).toEqual(["testimonial.approved"]);
  expect(dispatches).toHaveLength(1);
  expect(dispatches[0].url).toContain("/repos/oneloneraven/deaftly-website/dispatches");
  expect(dispatches[0].body).toEqual({ event_type: "testimonials-changed" });
});

test("withdraw sets withdrawn_at, audits and dispatches", async () => {
  await seedItem("i1");
  await seedQuote("q1", "i1", { approved_at: T });
  const dispatches = stubGithub();
  await withdraw(testEnv(), "q1", ACTOR);
  expect((await quote())?.withdrawn_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect((await audits()).map(event => event.action)).toEqual(["testimonial.withdrawn"]);
  expect(dispatches).toHaveLength(1);
});

test("approve and withdraw throw not-found for an unknown id", async () => {
  await expect(approve(testEnv(), "nope", ACTOR)).rejects.toThrow("not-found");
  await expect(withdraw(testEnv(), "nope", ACTOR)).rejects.toThrow("not-found");
});

test("a product without a site repository dispatches nothing", async () => {
  await seedItem("i1", { product: "cl" });
  await seedQuote("q1", "i1", { product: "cl" });
  const dispatches = stubGithub();
  await approve(testEnv(), "q1", ACTOR);
  expect(dispatches).toHaveLength(0);
  expect((await quote())?.approved_at).not.toBeNull();
});

test("a failed dispatch is logged by error name and does not undo the change", async () => {
  await seedItem("i1");
  await seedQuote("q1", "i1");
  stubGithub({ dispatchStatus: 500 });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await approve(testEnv(), "q1", ACTOR);
  expect((await quote())?.approved_at).not.toBeNull();
  expect(error).toHaveBeenCalledTimes(1);
  const entry = JSON.parse(String(error.mock.calls[0][0]));
  expect(entry).toMatchObject({ event: "testimonials.dispatch-failed", product: "deaftly" });
  expect(typeof entry.errorName).toBe("string");
  expect(JSON.stringify(entry)).not.toContain("love");
});

test("withdrawAllForItem withdraws only approved, unwithdrawn quotes and dispatches once", async () => {
  await seedItem("i1");
  await seedQuote("q1", "i1", { approved_at: T });
  await seedQuote("q2", "i1", { approved_at: T });
  await seedQuote("q3", "i1");
  await seedQuote("q4", "i1", { approved_at: T, withdrawn_at: "2026-03-02T00:00:00.000Z" });
  const dispatches = stubGithub();
  await withdrawAllForItem(testEnv(), "i1", ACTOR);
  expect((await quote("q1"))?.withdrawn_at).not.toBeNull();
  expect((await quote("q2"))?.withdrawn_at).not.toBeNull();
  expect((await quote("q3"))?.withdrawn_at).toBeNull();
  expect((await quote("q4"))?.withdrawn_at).toBe("2026-03-02T00:00:00.000Z");
  expect(dispatches).toHaveLength(1);
  expect((await audits()).map(event => event.action)).toEqual(["testimonial.withdrawn", "testimonial.withdrawn"]);
});

test("withdrawAllForItem with nothing to withdraw dispatches nothing", async () => {
  await seedItem("i1");
  await seedQuote("q1", "i1");
  const dispatches = stubGithub();
  await withdrawAllForItem(testEnv(), "i1", ACTOR);
  expect(dispatches).toHaveLength(0);
});

test("deleteItemWithTestimonials withdraws, dispatches, then deletes the item and its quotes", async () => {
  await seedItem("i1");
  await seedQuote("q1", "i1", { approved_at: T });
  const dispatches = stubGithub();
  await deleteItemWithTestimonials({ ...testEnv(), ATTACHMENTS: makeBucket() }, "i1", ACTOR);
  expect(dispatches).toHaveLength(1);
  expect(await quote()).toBeNull();
  expect(await baseEnv.DB.prepare("SELECT id FROM items WHERE id = 'i1'").first()).toBeNull();
  expect((await audits()).map(event => event.action)).toEqual(["testimonial.withdrawn", "item.deleted"]);
});

test("publicFeed lists approved, unwithdrawn quotes newest first without ids", async () => {
  await seedItem("i1");
  await seedItem("i2", { product: "cl" });
  await seedQuote("q1", "i1", { excerpt: "Older", approved_at: "2026-03-01T10:00:00.000Z" });
  await seedQuote("q2", "i1", { excerpt: "Newer 😍", attribution: "J. S.", approved_at: "2026-03-05T23:59:59.000Z" });
  await seedQuote("q3", "i1", { excerpt: "Pending" });
  await seedQuote("q4", "i1", { excerpt: "Withdrawn", approved_at: T, withdrawn_at: T });
  await seedQuote("q5", "i2", { product: "cl", excerpt: "Other product", approved_at: T });
  const response = await publicFeed(testEnv(), "deaftly");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-cache");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  const feed = await response.json();
  expect(feed).toEqual([
    { text: "Newer 😍", attribution: "J. S.", date: "2026-03-05" },
    { text: "Older", attribution: "Jamie Smith", date: "2026-03-01" },
  ]);
});

test("publicFeed is 404 for an unknown slug or when testimonials are disabled", async () => {
  expect((await publicFeed(testEnv(), "nope")).status).toBe(404);
  await baseEnv.DB.exec("UPDATE products SET testimonials_enabled = 0 WHERE slug = 'deaftly'");
  expect((await publicFeed(testEnv(), "deaftly")).status).toBe(404);
});

test("the feed is served on the public host for GET only, and not on the admin host", async () => {
  await seedItem("i1");
  await seedQuote("q1", "i1", { approved_at: T });
  const url = "https://engage-api.oneloneraven.com/v1/testimonials/deaftly";
  const ok = await worker.fetch(new Request(url), testEnv(), makeCtx());
  expect(ok.status).toBe(200);
  expect(ok.headers.get("Cache-Control")).toBe("no-cache");
  expect((await worker.fetch(new Request(url, { method: "POST" }), testEnv(), makeCtx())).status).toBe(404);
  const admin = await worker.fetch(
    new Request("https://engage.oneloneraven.com/v1/testimonials/deaftly"),
    testEnv({ ADMIN_ACCESS_CHECK: "off", APP_ENV: "development" }),
    makeCtx(),
  );
  expect(admin.status).toBe(404);
});
