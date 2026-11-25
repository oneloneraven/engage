import { notifyRelease } from "../discord.js";
import { json } from "../lib/http.js";
import { getProduct } from "../registry.js";
import { gatedRepo } from "./registry.js";
import { createRelease } from "./store.js";

const CALLBACK = /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/deployment_protection_rule$/;

/**
 * @typedef {{
 *   action?: string,
 *   environment?: string,
 *   deployment_callback_url?: string,
 *   deployment?: { sha?: string, ref?: string },
 *   repository?: { full_name?: string },
 *   installation?: { id?: number },
 * }} ProtectionRulePayload
 */

/**
 * GitHub asks Engage to approve a deployment. A gated repository and environment become a pending release and a
 * content-free ping; anything else is acknowledged and ignored, so other repositories can't fill the list.
 * @param {{ DB: import("../lib/db.js").Database, ADMIN_HOST?: string, APP_ENV?: string, RELEASE_VERSION?: string }} env
 * @param {ProtectionRulePayload} payload
 * @returns {Promise<Response>}
 */
export async function handleProtectionRule(env, payload) {
  if (payload.action !== "requested") return new Response(null, { status: 204 });
  const repo = payload.repository?.full_name;
  const environment = payload.environment;
  if (!repo || !environment) return json({ error: "invalid-body" }, 400);
  const gated = await gatedRepo(env, repo);
  if (!gated?.environments.includes(environment)) return new Response(null, { status: 204 });

  const runId = CALLBACK.exec(payload.deployment_callback_url ?? "")?.[1];
  const sha = payload.deployment?.sha;
  const installationId = payload.installation?.id;
  if (!runId || !sha || typeof installationId !== "number") return json({ error: "invalid-body" }, 400);

  const { id, created } = await createRelease(env, {
    repo: gated.repo,
    product: gated.product,
    environment,
    sha,
    ref: payload.deployment?.ref ?? null,
    runId: Number(runId),
    callbackUrl: /** @type {string} */ (payload.deployment_callback_url),
    installationId,
  });
  if (created) {
    const product = await getProduct(env, gated.product);
    if (product) await notifyRelease(env, product, id);
  }
  return new Response(null, { status: 204 });
}
