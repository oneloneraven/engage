import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { getProduct, productForEmailDomain, productForOrigin } from "../src/registry.js";

test("getProduct returns the seeded product with decoded columns", async () => {
  const product = await getProduct(env, "cl");
  expect(product?.name).toBe("Climbing Logbook");
  expect(product?.domains).toEqual(["climbinglogbook.com", "beta.climbinglogbook.com", "my.climbinglogbook.com"]);
  expect(product?.emailAliases).toEqual(["hello", "support"]);
  expect(product?.contextSchema.errorRef.maxLength).toBe(64);
  expect(product?.testimonialsEnabled).toBe(true);
  expect(product?.backupForwardTo).toBeNull();
  expect(product?.discordSecret).toBe("DISCORD_WEBHOOK_CL");
  expect(product?.accountSecret).toBe("ACCOUNT_SECRET_CL");
  expect(product?.thanksUrl).toBe("https://climbinglogbook.com/feedback/thanks");
});

test("getProduct carries the site repository settings", async () => {
  const product = await getProduct(env, "deaftly");
  expect(product?.siteRepo).toBe("oneloneraven/deaftly-website");
  expect(product?.siteDispatchEvent).toBe("testimonials-changed");
  expect(product?.thanksUrl).toBe("https://deaftly.com/feedback/thanks/");
});

test("getProduct returns null for an unknown slug", async () => {
  expect(await getProduct(env, "nope")).toBeNull();
});

test("productForOrigin matches a registered origin", async () => {
  expect((await productForOrigin(env, "https://beta.climbinglogbook.com"))?.slug).toBe("cl");
  expect((await productForOrigin(env, "https://deaftly.com"))?.slug).toBe("deaftly");
});

test("productForOrigin returns null for an unregistered origin", async () => {
  expect(await productForOrigin(env, "https://evil.example")).toBeNull();
  expect(await productForOrigin(env, "https://climbinglogbook.com.evil.example")).toBeNull();
});

test("productForOrigin returns null for a malformed origin", async () => {
  expect(await productForOrigin(env, "not a url")).toBeNull();
  expect(await productForOrigin(env, "")).toBeNull();
});

test("productForEmailDomain matches the email domain exactly, ignoring case", async () => {
  expect((await productForEmailDomain(env, "climbinglogbook.com"))?.slug).toBe("cl");
  expect((await productForEmailDomain(env, "DEAFTLY.com"))?.slug).toBe("deaftly");
  expect(await productForEmailDomain(env, "beta.climbinglogbook.com")).toBeNull();
  expect(await productForEmailDomain(env, "")).toBeNull();
});
