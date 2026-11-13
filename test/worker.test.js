import { expect, test } from "vitest";
import worker from "../src/worker.js";

const env = { APP_ENV: "test", RELEASE_VERSION: "v1.2.3", ASSETS: { fetch: async () => new Response("asset") } };

test("health reports the environment and release", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), env);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, environment: "test", version: "v1.2.3" });
});

test("everything else is served from static assets", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), env);
  expect(await response.text()).toBe("asset");
});
