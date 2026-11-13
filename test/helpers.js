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
  await env.DB.exec("DELETE FROM messages");
  await env.DB.exec("DELETE FROM items");
}
