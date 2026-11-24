import { log } from "./log.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

/**
 * Fails closed: a missing token, secret or sitekey, an outage, any answer but success, and a token solved on a hostname not in `hostnames` all refuse.
 * @param {string | null | undefined} token
 * @param {string | null | undefined} ip
 * @param {{ TURNSTILE_SECRET_KEY?: string, TURNSTILE_SITEKEY?: string, APP_ENV?: string, RELEASE_VERSION?: string }} env
 * @param {readonly string[]} hostnames
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstile(token, ip, env, hostnames) {
  if (!token || !env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITEKEY) return false;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip ?? undefined }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      log(env, "warn", "turnstile.unavailable", { status: response.status });
      return false;
    }
    const result = /** @type {{ success?: unknown, hostname?: unknown }} */ (await response.json());
    return result.success === true && typeof result.hostname === "string" && hostnames.includes(result.hostname);
  } catch (error) {
    log(env, "warn", "turnstile.unavailable", { errorName: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}
