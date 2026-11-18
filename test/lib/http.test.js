import { expect, test } from "vitest";
import { json } from "../../src/lib/http.js";

test("json defaults to no-store, and a caller's Cache-Control replaces it whatever its case", () => {
  expect(json({}).headers.get("Cache-Control")).toBe("no-store");
  expect(json({}, 200, { "Cache-Control": "no-cache" }).headers.get("Cache-Control")).toBe("no-cache");
  expect(json({}, 200, { "cache-control": "public" }).headers.get("Cache-Control")).toBe("public");
  expect(json({}, 201, { Vary: "Origin" }).headers.get("Vary")).toBe("Origin");
});
