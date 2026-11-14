import { routeAdmin } from "./admin/router.js";
import { handleGithubWebhook } from "./github/webhook.js";
import { adminIdentity } from "./lib/access.js";
import { handleAccountDelete } from "./intake/accounts.js";
import { handleInboundEmail } from "./email/inbound.js";
import { handleSubmission } from "./intake/submissions.js";
import { publicFeed } from "./testimonials/testimonials.js";
import { forbidden, json, notFound } from "./lib/http.js";
import { runRetention } from "./retention.js";

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
 *   OWNER_EMAIL?: string,
 *   ATTACHMENTS: {
 *     put: (key: string, value: ArrayBuffer | Uint8Array, options: { httpMetadata: { contentType: string } }) => Promise<unknown>,
 *     get: (key: string) => Promise<{ body: ReadableStream } | null>,
 *     delete: (keys: string | string[]) => Promise<unknown>,
 *   },
 *   EMAIL: import("./email/outbound.js").OutboundEnv["EMAIL"],
 *   GITHUB_APP_ID?: string,
 *   GITHUB_APP_PRIVATE_KEY?: string,
 *   REPLY_ADDRESS_SECRET?: string,
 *   TURNSTILE_SECRET_KEY?: string,
 *   INTAKE_WEB_LIMITER?: import("./lib/rate-limit.js").RateLimiter,
 *   INTAKE_APP_LIMITER?: import("./lib/rate-limit.js").RateLimiter,
 * }} Env
 */

/** @typedef {{ waitUntil: (promise: Promise<unknown>) => void }} Context */

const FEED_PATH = /^\/v1\/testimonials\/([^/]+)$/;
const ACCOUNT_PATH = /^\/v1\/accounts\/([^/]+)\/([^/]+)$/;

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
  if (pathname === "/v1/github/webhook") return handleGithubWebhook(request, env);
  if (pathname === "/v1/submissions" && ["POST", "OPTIONS"].includes(request.method)) {
    return handleSubmission(request, env, ctx);
  }
  const feed = FEED_PATH.exec(pathname);
  if (feed && request.method === "GET") {
    const segments = decodeSegments(feed[1]);
    if (segments) return publicFeed(env, segments[0]);
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
      return identity ? routeAdmin(request, env, ctx, identity) : forbidden();
    }
    if (env.PUBLIC_HOST && hostname === env.PUBLIC_HOST) return routePublic(request, env, ctx);
    return notFound();
  },
  /**
   * @param {import("./email/inbound.js").InboundMessage} message
   * @param {Env} env
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  email: (message, env, ctx) => handleInboundEmail(message, env, ctx),
  /**
   * @param {{ scheduledTime: number }} controller
   * @param {Env} env
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runRetention(env, new Date(controller.scheduledTime)));
  },
};
