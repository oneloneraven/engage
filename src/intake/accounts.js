import { forbidden, json } from "../lib/http.js";
import { log } from "../lib/log.js";
import { clientIp, isLimited } from "../lib/rate-limit.js";
import { namedSecret } from "../lib/secrets.js";
import { getProduct } from "../registry.js";

/** @param {string} value */
async function sha256(value) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

/**
 * @param {string} presented
 * @param {string} expected
 */
async function secretMatches(presented, expected) {
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)]);
  const subtle = /** @type {SubtleCrypto & { timingSafeEqual: (a: ArrayBuffer, b: ArrayBuffer) => boolean }} */ (
    crypto.subtle
  );
  return subtle.timingSafeEqual(a, b);
}

/**
 * @param {Request} request
 * @param {import("../worker.js").Env} env
 * @param {string} productSlug
 * @param {string} accountRef
 * @returns {Promise<Response>}
 */
export async function handleAccountDelete(request, env, productSlug, accountRef) {
  if (await isLimited(env.INTAKE_APP_LIMITER, `account:${clientIp(request)}`)) {
    return json({ error: "rate-limited" }, 429);
  }
  const product = await getProduct(env, productSlug);
  if (!product) return forbidden();
  const secret = namedSecret(env, product.accountSecret);
  if (!secret) {
    log(env, "warn", "account.secret-missing", { product: product.slug });
    return forbidden();
  }
  const presented = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!presented || !(await secretMatches(presented, secret))) return forbidden();

  await env.DB.prepare("UPDATE items SET account_ref = NULL WHERE product = ? AND account_ref = ?")
    .bind(product.slug, accountRef)
    .run();
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
