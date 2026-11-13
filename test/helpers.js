import { env } from "cloudflare:test";
import { vi } from "vitest";

export const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const DISCORD_URL = "https://discord.example/api/webhooks/1/token";

export function makeLimiter(success = true) {
  /** @type {string[]} */
  const keys = [];
  return {
    keys,
    limit: async (/** @type {{ key: string }} */ { key }) => {
      keys.push(key);
      return { success };
    },
  };
}

export function makeCtx() {
  /** @type {Promise<unknown>[]} */
  const pending = [];
  return {
    waitUntil: (/** @type {Promise<unknown>} */ promise) => {
      pending.push(promise);
    },
    passThroughOnException: () => {},
    settled: () => Promise.allSettled(pending),
  };
}

export function makeEnv(overrides = {}) {
  return {
    ...env,
    ADMIN_HOST: "engage.oneloneraven.com",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    DISCORD_WEBHOOK_CL: DISCORD_URL,
    DISCORD_WEBHOOK_DEAFTLY: DISCORD_URL,
    ACCOUNT_SECRET_CL: "cl-account-secret",
    INTAKE_WEB_LIMITER: makeLimiter(),
    INTAKE_APP_LIMITER: makeLimiter(),
    ...overrides,
  };
}

/** Stubs fetch for Turnstile (a token of "bad" fails) and Discord, recording every call. */
export function stubFetch({ discordStatus = 204 } = {}) {
  /** @type {{ url: string, body: any }[]} */
  const calls = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url === TURNSTILE_URL) return Response.json({ success: body.response !== "bad" });
    if (url === DISCORD_URL) return new Response(null, { status: discordStatus });
    return new Response("unexpected", { status: 599 });
  });
  return {
    spy,
    turnstile: () => calls.filter(call => call.url === TURNSTILE_URL),
    discord: () => calls.filter(call => call.url === DISCORD_URL),
  };
}

export async function resetItems() {
  await env.DB.exec("DELETE FROM attachments");
  await env.DB.exec("DELETE FROM messages");
  await env.DB.exec("DELETE FROM items");
}

const encoder = new TextEncoder();

/** @param {string} raw */
function headersOf(raw) {
  const headers = new Headers();
  const block = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0 && /^[\x20-\x7e]*$/.test(line)) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  return headers;
}

/**
 * A ForwardableEmailMessage over a raw message, recording what the handler does with it.
 * @param {{ to: string, raw: string, from?: string, forwardFails?: boolean }} options
 */
export function makeEmailMessage({ to, raw, from = "alex@example.org", forwardFails = false }) {
  const bytes = encoder.encode(raw.replace(/\r?\n/g, "\r\n"));
  /** @type {string[]} */
  const rejected = [];
  /** @type {string[]} */
  const forwarded = [];
  return {
    from,
    to,
    headers: headersOf(raw),
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    rawSize: bytes.byteLength,
    rejected,
    forwarded,
    setReject: (/** @type {string} */ reason) => {
      rejected.push(reason);
    },
    forward: async (/** @type {string} */ address) => {
      forwarded.push(address);
      if (forwardFails) throw new Error(`cannot forward to ${address}`);
    },
    reply: async () => {},
  };
}

/** An R2 bucket in memory. */
export function makeBucket() {
  /** @type {Map<string, { value: ArrayBuffer, options: any }>} */
  const objects = new Map();
  return {
    objects,
    put: async (/** @type {string} */ key, /** @type {ArrayBuffer} */ value, /** @type {any} */ options) => {
      objects.set(key, { value, options });
    },
    delete: async (/** @type {string | string[]} */ keys) => {
      for (const key of [keys].flat()) objects.delete(key);
    },
  };
}
