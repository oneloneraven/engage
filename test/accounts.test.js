import { env } from "cloudflare:test";
import { beforeEach, expect, test, vi } from "vitest";
import { handleAccountDelete } from "../src/intake/accounts.js";
import { makeEnv, makeLimiter, resetItems } from "./helpers.js";

const url = (product, ref) => `https://engage-api.oneloneraven.com/v1/accounts/${product}/${ref}`;
const del = (secret, extra = {}) =>
  new Request(url("cl", "acct-1"), {
    method: "DELETE",
    headers: { "CF-Connecting-IP": "203.0.113.9", ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...extra },
  });

const insert = (id, product, ref) =>
  env.DB.prepare(
    "INSERT INTO items (id, product, kind, source, account_ref, created_at, last_activity_at) VALUES (?, ?, 'issue', 'app', ?, 'x', 'x')",
  )
    .bind(id, product, ref)
    .run();

const refs = async () =>
  Object.fromEntries(
    (await env.DB.prepare("SELECT id, account_ref FROM items").all()).results.map(r => [r.id, r.account_ref]),
  );

beforeEach(async () => {
  await resetItems();
  await insert("A", "cl", "acct-1");
  await insert("B", "cl", "acct-1");
  await insert("C", "cl", "acct-2");
  await insert("D", "deaftly", "acct-1");
});

test("the right secret clears the reference on that product's matching items", async () => {
  const response = await handleAccountDelete(del("cl-account-secret"), makeEnv(), "cl", "acct-1");
  expect(response.status).toBe(204);
  expect(await refs()).toEqual({ A: null, B: null, C: "acct-2", D: "acct-1" });
});

test("a wrong, missing or malformed secret is a 403 that changes nothing", async () => {
  for (const request of [
    del("wrong"),
    del(undefined),
    del("cl-account-secret", { Authorization: "Basic cl-account-secret" }),
  ]) {
    expect((await handleAccountDelete(request, makeEnv(), "cl", "acct-1")).status).toBe(403);
  }
  expect(await refs()).toEqual({ A: "acct-1", B: "acct-1", C: "acct-2", D: "acct-1" });
});

test("another product's secret is refused", async () => {
  const testEnv = makeEnv({ ACCOUNT_SECRET_DEAFTLY: "deaftly-secret" });
  const response = await handleAccountDelete(del("deaftly-secret"), testEnv, "cl", "acct-1");
  expect(response.status).toBe(403);
});

test("a product with no secret configured refuses everything, even an empty bearer", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const testEnv = makeEnv({ ACCOUNT_SECRET_CL: undefined });
  expect((await handleAccountDelete(del("anything"), testEnv, "cl", "acct-1")).status).toBe(403);
  expect((await handleAccountDelete(del(""), testEnv, "cl", "acct-1")).status).toBe(403);
  expect(warn.mock.calls.flat().join(" ")).toContain("account.secret-missing");
  warn.mockRestore();
  expect(await refs()).toMatchObject({ A: "acct-1" });
});

test("an unknown product is a 403, the same as a wrong secret", async () => {
  expect((await handleAccountDelete(del("cl-account-secret"), makeEnv(), "nope", "acct-1")).status).toBe(403);
});

test("a limited caller gets a 429 before the secret is checked", async () => {
  const limiter = makeLimiter(false);
  const response = await handleAccountDelete(
    del("cl-account-secret"),
    makeEnv({ INTAKE_APP_LIMITER: limiter }),
    "cl",
    "acct-1",
  );
  expect(response.status).toBe(429);
  expect(limiter.keys).toEqual(["account:203.0.113.9"]);
  expect(await refs()).toMatchObject({ A: "acct-1" });
});

test("clearing a reference nothing holds is still a 204", async () => {
  expect((await handleAccountDelete(del("cl-account-secret"), makeEnv(), "cl", "ghost")).status).toBe(204);
});
