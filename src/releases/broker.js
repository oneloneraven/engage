import { recordAudit } from "../audit.js";
import { json } from "../lib/http.js";
import { log } from "../lib/log.js";
import { clientIp, isLimited } from "../lib/rate-limit.js";
import { verifyActionsToken } from "./oidc.js";
import { gatedRepo } from "./registry.js";
import { spendRelease } from "./store.js";

const AUDIENCE = "engage";
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/**
 * @typedef {{
 *   DB: import("../lib/db.js").Database,
 *   BROKER_LIMITER?: import("../lib/rate-limit.js").RateLimiter,
 *   CLOUDFLARE_BROKER_TOKEN?: string,
 *   CLOUDFLARE_ACCOUNT_ID?: string,
 *   APP_ENV?: string,
 *   RELEASE_VERSION?: string,
 * }} BrokerEnv
 */

/** @param {string} error @param {number} status */
const refuse = (error, status) => json({ error }, status);

/**
 * Exchanges a GitHub Actions OIDC token for a short-lived Cloudflare token, only for the approved release of exactly
 * that run. The release is spent before the mint, and restored if the mint fails, so it yields one credential at most.
 * @param {Request} request
 * @param {BrokerEnv} env
 * @param {{ fetchJwks?: () => Promise<{ keys: import("./oidc.js").Jwk[] }>, now?: number }} [options]
 * @returns {Promise<Response>}
 */
export async function handleDeployCredentials(request, env, options = {}) {
  if (await isLimited(env.BROKER_LIMITER, `broker:${clientIp(request)}`)) return refuse("rate-limited", 429);
  if (!env.CLOUDFLARE_BROKER_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    log(env, "error", "broker.not-configured");
    return refuse("broker-not-configured", 503);
  }
  const presented = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!presented) return refuse("unauthorised", 401);

  let claims;
  try {
    claims = await verifyActionsToken(presented, { audience: AUDIENCE, ...options });
  } catch (error) {
    log(env, "warn", "broker.token-refused", {
      reason: /** @type {{ reason?: string }} */ (error).reason ?? "unknown",
    });
    return refuse("unauthorised", 401);
  }

  const gated = await gatedRepo(env, claims.repository);
  if (!gated?.environments.includes(claims.environment)) return refuse("forbidden", 403);
  const policies = /** @type {{ policies?: unknown[] }} */ (gated.tokenPolicy).policies;
  if (!Array.isArray(policies) || policies.length === 0) {
    log(env, "error", "broker.no-token-policy", { repo: gated.repo });
    return refuse("broker-not-configured", 503);
  }

  const runId = Number(claims.run_id);
  const match = { repo: gated.repo, environment: claims.environment, sha: claims.sha, runId };
  const release = await spendRelease(env, match);
  if (!release) {
    const spent = await env.DB.prepare(
      "SELECT 1 FROM releases WHERE lower(repo) = lower(?) AND environment = ? AND sha = ? AND run_id = ? AND state = 'spent'",
    )
      .bind(match.repo, match.environment, match.sha, runId)
      .first();
    return spent ? refuse("already-issued", 409) : refuse("forbidden", 403);
  }

  const expiresAt = new Date((options.now ?? Date.now()) + TOKEN_LIFETIME_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  let minted;
  try {
    const response = await fetch(`${CLOUDFLARE_API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_BROKER_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Engage deploy: ${gated.repo} ${claims.environment} run ${runId}`,
        policies,
        expires_on: expiresAt,
      }),
    });
    const body = /** @type {{ success?: boolean, result?: { value?: string } }} */ (await response.json());
    if (!response.ok || !body.success || !body.result?.value) throw new Error(`cloudflare-${response.status}`);
    minted = body.result.value;
  } catch (error) {
    await env.DB.prepare("UPDATE releases SET state = 'approved', spent_at = NULL WHERE id = ? AND state = 'spent'")
      .bind(release.id)
      .run();
    log(env, "error", "broker.mint-failed", { errorName: error instanceof Error ? error.message : "unknown" });
    return refuse("mint-failed", 502);
  }

  await recordAudit(env, {
    actor: "github-actions",
    action: "release.credential-minted",
    targetType: "release",
    targetId: release.id,
    detail: { repo: gated.repo, environment: claims.environment, runId, expiresAt },
  });
  return json({ token: minted, expiresAt });
}
