import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../../src/lib/turnstile.js";

const ENV = { TURNSTILE_SECRET_KEY: "secret", TURNSTILE_SITEKEY: "sitekey" };

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
    const stub = stubFetch(async () => Response.json({ success: true }));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(true);
    const [url, init] = stub.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ secret: "secret", response: "token", remoteip: "203.0.113.9" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives the request a five second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    stubFetch(async () => Response.json({ success: true }));
    await verifyTurnstile("token", "203.0.113.9", ENV);
    expect(timeout).toHaveBeenCalledWith(5000);
  });

  it("refuses a missing token without calling Cloudflare", async () => {
    const stub = stubFetch(async () => Response.json({ success: true }));
    expect(await verifyTurnstile("", "203.0.113.9", ENV)).toBe(false);
    expect(await verifyTurnstile(null, "203.0.113.9", ENV)).toBe(false);
    expect(await verifyTurnstile(undefined, "203.0.113.9", ENV)).toBe(false);
    expect(stub).not.toHaveBeenCalled();
  });

  it("refuses a missing secret or sitekey without calling Cloudflare", async () => {
    const stub = stubFetch(async () => Response.json({ success: true }));
    expect(await verifyTurnstile("token", "203.0.113.9", {})).toBe(false);
    expect(await verifyTurnstile("token", "203.0.113.9", { ...ENV, TURNSTILE_SECRET_KEY: "" })).toBe(false);
    expect(await verifyTurnstile("token", "203.0.113.9", { ...ENV, TURNSTILE_SITEKEY: "" })).toBe(false);
    expect(await verifyTurnstile("token", "203.0.113.9", { TURNSTILE_SECRET_KEY: "secret" })).toBe(false);
    expect(stub).not.toHaveBeenCalled();
  });

  it("refuses a non-OK response", async () => {
    stubFetch(async () => Response.json({ success: true }, { status: 503 }));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
  });

  it("refuses when the request fails or times out", async () => {
    stubFetch(async () => {
      throw new TypeError("network");
    });
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
    stubFetch(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
  });

  it("logs an outage without the secret or token", async () => {
    const warn = vi.mocked(console.warn);
    stubFetch(async () => Response.json({}, { status: 503 }));
    await verifyTurnstile("token", "203.0.113.9", ENV);
    stubFetch(async () => {
      throw new TypeError("network");
    });
    await verifyTurnstile("token", "203.0.113.9", ENV);
    const logged = warn.mock.calls.map(call => JSON.parse(String(call[0])));
    expect(logged).toEqual([
      expect.objectContaining({ event: "turnstile.unavailable", status: 503 }),
      expect.objectContaining({ event: "turnstile.unavailable", errorName: "TypeError" }),
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/secret|token|203\.0\.113\.9/);
  });

  it("refuses a response that is not JSON", async () => {
    stubFetch(async () => new Response("not json"));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
  });

  it.each([{ success: false }, {}, { success: "true" }, { success: 1 }, { success: null }, null, []])(
    "refuses %j",
    async body => {
      stubFetch(async () => Response.json(body));
      expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
    },
  );
});
