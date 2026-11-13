import { adminIdentity } from "./lib/access.js";
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
 * }} Env
 */

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

/** @param {Request} _request */
async function routePublic(_request) {
  return notFound();
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const { hostname, pathname } = new URL(request.url);
    if (pathname === "/api/health") {
      return json({ ok: true, environment: env.APP_ENV, version: env.RELEASE_VERSION ?? "unreleased" });
    }
    if (env.ADMIN_HOST && hostname === env.ADMIN_HOST) {
      const identity = await adminIdentity(request, env);
      return identity ? routeAdmin(request, env, identity) : forbidden();
    }
    if (env.PUBLIC_HOST && hostname === env.PUBLIC_HOST) return routePublic(request);
    return notFound();
  },
};
