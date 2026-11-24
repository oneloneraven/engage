import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../../src/lib/turnstile.js";

const ENV = { TURNSTILE_SECRET_KEY: "secret", TURNSTILE_SITEKEY: "sitekey" };
const HOSTS = ["example.com", "beta.example.com"];

/** @param {() => Promise<Response>} respond */
function stubFetch(respond) {
  const stub = vi.fn(respond);
  vi.stubGlobal("fetch", stub);
  return stub;
}

describe("verifyTurnstile", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accepts a token Cloudflare confirms, posting the secret, token and address as JSON", async () => {
    const stub = stubFetch(async () => Response.json({ success: true, hostname: "example.com" }));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS)).toBe(true);
    const [url, init] = stub.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ secret: "secret", response: "token", remoteip: "203.0.113.9" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives the request a five second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    stubFetch(async () => Response.json({ success: true, hostname: "example.com" }));
    await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS);
    expect(timeout).toHaveBeenCalledWith(5000);
  });

  it("refuses a missing token without calling Cloudflare", async () => {
    const stub = stubFetch(async () => Response.json({ success: true, hostname: "example.com" }));
    expect(await verifyTurnstile("", "203.0.113.9", ENV, HOSTS)).toBe(false);
    expect(await verifyTurnstile(null, "203.0.113.9", ENV, HOSTS)).toBe(false);
    expect(await verifyTurnstile(undefined, "203.0.113.9", ENV, HOSTS)).toBe(false);
    expect(stub).not.toHaveBeenCalled();
  });

  it("refuses a missing secret or sitekey without calling Cloudflare", async () => {
    const stub = stubFetch(async () => Response.json({ success: true, hostname: "example.com" }));
    expect(await verifyTurnstile("token", "203.0.113.9", {}, HOSTS)).toBe(false);
    expect(await verifyTurnstile("token", "203.0.113.9", { ...ENV, TURNSTILE_SECRET_KEY: "" }, HOSTS)).toBe(false);
    expect(await verifyTurnstile("token", "203.0.113.9", { ...ENV, TURNSTILE_SITEKEY: "" }, HOSTS)).toBe(false);
    expect(await verifyTurnstile("token", "203.0.113.9", { TURNSTILE_SECRET_KEY: "secret" }, HOSTS)).toBe(false);
    expect(stub).not.toHaveBeenCalled();
  });

  it("refuses a non-OK response", async () => {
    stubFetch(async () => Response.json({ success: true }, { status: 503 }));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS)).toBe(false);
  });

  it("refuses when the request fails or times out", async () => {
    stubFetch(async () => {
      throw new TypeError("network");
    });
    expect(await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS)).toBe(false);
    stubFetch(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS)).toBe(false);
  });

  it("logs an outage without the secret or token", async () => {
    const warn = vi.mocked(console.warn);
    stubFetch(async () => Response.json({}, { status: 503 }));
    await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS);
    stubFetch(async () => {
      throw new TypeError("network");
    });
    await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS);
    const logged = warn.mock.calls.map(call => JSON.parse(String(call[0])));
    expect(logged).toEqual([
      expect.objectContaining({ event: "turnstile.unavailable", status: 503 }),
      expect.objectContaining({ event: "turnstile.unavailable", errorName: "TypeError" }),
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/secret|token|203\.0\.113\.9/);
  });

  it("accepts a token solved on any of the given hostnames", async () => {
    stubFetch(async () => Response.json({ success: true, hostname: "beta.example.com" }));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS)).toBe(true);
  });

  it.each([
    { hostname: "other.example" },
    { hostname: "EXAMPLE.COM" },
    {},
    { hostname: null },
    { hostname: ["example.com"] },
  ])("refuses a successful token with %j", async extra => {
    stubFetch(async () => Response.json({ success: true, ...extra }));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS)).toBe(false);
  });

  it("refuses a response that is not JSON", async () => {
    stubFetch(async () => new Response("not json"));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS)).toBe(false);
  });

  it.each([{ success: false }, {}, { success: "true" }, { success: 1 }, { success: null }, null, []])(
    "refuses %j",
    async body => {
      stubFetch(async () => Response.json(body));
      expect(await verifyTurnstile("token", "203.0.113.9", ENV, HOSTS)).toBe(false);
    },
  );
});
