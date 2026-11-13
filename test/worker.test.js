import { expect, test } from "vitest";
import worker from "../src/worker.js";

const env = {
  APP_ENV: "production",
  RELEASE_VERSION: "v1.2.3",
  ADMIN_HOST: "engage.oneloneraven.com",
  PUBLIC_HOST: "engage-api.oneloneraven.com",
  ACCESS_TEAM_DOMAIN: "oneloneraven.cloudflareaccess.com",
  ACCESS_AUD: "",
  ASSETS: { fetch: async () => new Response("asset") },
};

/** @param {string} url */
const get = url => worker.fetch(new Request(url), env);

test("health answers on every host, uncached", async () => {
  for (const host of ["engage.oneloneraven.com", "engage-api.oneloneraven.com", "pr-1-engage-preview.example.dev"]) {
    const response = await get(`https://${host}/api/health`);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, environment: "production", version: "v1.2.3" });
  }
});

test("the admin host refuses its API and its pages without a verified Access token", async () => {
  expect((await get("https://engage.oneloneraven.com/api/items")).status).toBe(403);
  expect((await get("https://engage.oneloneraven.com/")).status).toBe(403);
});

test("the public host never serves admin paths or pages", async () => {
  expect((await get("https://engage-api.oneloneraven.com/api/items")).status).toBe(404);
  expect((await get("https://engage-api.oneloneraven.com/")).status).toBe(404);
});

test("the admin host never serves public paths", async () => {
  const local = { ...env, APP_ENV: "e2e", ADMIN_HOST: "localhost", ADMIN_ACCESS_CHECK: "off" };
  expect((await worker.fetch(new Request("https://localhost/v1/testimonials/cl"), local)).status).toBe(404);
  expect(await (await worker.fetch(new Request("https://localhost/"), local)).text()).toBe("asset");
});

test("any other host gets nothing", async () => {
  expect((await get("https://other.example/")).status).toBe(404);
});
