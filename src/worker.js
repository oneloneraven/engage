import { adminIdentity } from "./lib/access.js";
import { handleAccountDelete } from "./intake/accounts.js";
import { handleSubmission } from "./intake/submissions.js";
import { forbidden, json, notFound } from "./lib/http.js";

/**
 * @typedef {{
 *   ASSETS: { fetch: (request: Request) => Promise<Response> },
 *   DB: import("./lib/db.js").Database,
 *   APP_ENV: string,
 *   RELEASE_VERSION?: string,
 *   ADMIN_HOST?: string,
 *   PUBLIC_HOST?: string,
 *   ADMIN_ACCESS_CHECK?: string,
 *   ACCESS_TEAM_DOMAIN?: string,
 *   ACCESS_AUD?: string,
 *   TURNSTILE_SECRET_KEY?: string,
 *   INTAKE_WEB_LIMITER?: import("./lib/rate-limit.js").RateLimiter,
 *   INTAKE_APP_LIMITER?: import("./lib/rate-limit.js").RateLimiter,
 * }} Env
 */

/** @typedef {{ waitUntil: (promise: Promise<unknown>) => void }} Context */

const ACCOUNT_PATH = /^\/v1\/accounts\/([^/]+)\/([^/]+)$/;

/**
 * @param {Request} request
 * @param {Env} env
 * @param {{ email: string }} _identity
 */
async function routeAdmin(request, env, _identity) {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/") || pathname.startsWith("/v1/")) return notFound();
  return env.ASSETS.fetch(request);
}

/** @param {string[]} segments */
function decodeSegments(...segments) {
  try {
    return segments.map(decodeURIComponent);
  } catch {
    return null;
  }
}

/**
 * @param {Request} request
 * @param {Env} env
 * @param {Context} ctx
 */
async function routePublic(request, env, ctx) {
  const { pathname } = new URL(request.url);
  if (pathname === "/v1/submissions" && ["POST", "OPTIONS"].includes(request.method)) {
    return handleSubmission(request, env, ctx);
  }
  const account = ACCOUNT_PATH.exec(pathname);
  if (account && request.method === "DELETE") {
    const segments = decodeSegments(account[1], account[2]);
    if (segments) return handleAccountDelete(request, env, segments[0], segments[1]);
  }
  return notFound();
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {Context} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    const { hostname, pathname } = new URL(request.url);
    if (pathname === "/api/health") {
      return json({ ok: true, environment: env.APP_ENV, version: env.RELEASE_VERSION ?? "unreleased" });
    }
    if (env.ADMIN_HOST && hostname === env.ADMIN_HOST) {
      const identity = await adminIdentity(request, env);
      return identity ? routeAdmin(request, env, identity) : forbidden();
    }
    if (env.PUBLIC_HOST && hostname === env.PUBLIC_HOST) return routePublic(request, env, ctx);
    return notFound();
  },
};
