import { recordAudit } from "../audit.js";
import { newId } from "../lib/ids.js";

/** @typedef {"pending" | "approved" | "rejected" | "expired" | "spent"} ReleaseState */
/**
 * @typedef {{
 *   id: string, repo: string, product: string, productName: string, environment: string, sha: string,
 *   ref: string | null, runId: number, callbackUrl: string, installationId: number, state: ReleaseState,
 *   note: string | null, createdAt: string, decidedAt: string | null, decidedBy: string | null, spentAt: string | null,
 * }} Release
 */
/** @typedef {{ DB: import("../lib/db.js").Database }} ReleaseEnv */

const COLUMNS = "releases.*, (SELECT name FROM products WHERE products.slug = releases.product) AS product_name";

/** @param {Record<string, unknown>} row @returns {Release} */
function toRelease(row) {
  return {
    id: String(row.id),
    repo: String(row.repo),
    product: String(row.product),
    productName: String(row.product_name ?? row.product),
    environment: String(row.environment),
    sha: String(row.sha),
    ref: /** @type {string | null} */ (row.ref ?? null),
    runId: Number(row.run_id),
    callbackUrl: String(row.callback_url),
    installationId: Number(row.installation_id),
    state: /** @type {ReleaseState} */ (row.state),
    note: /** @type {string | null} */ (row.note ?? null),
    createdAt: String(row.created_at),
    decidedAt: /** @type {string | null} */ (row.decided_at ?? null),
    decidedBy: /** @type {string | null} */ (row.decided_by ?? null),
    spentAt: /** @type {string | null} */ (row.spent_at ?? null),
  };
}

/**
 * Stores a pending release, or finds the one already pending for this run and environment.
 * @param {ReleaseEnv} env
 * @param {{ repo: string, product: string, environment: string, sha: string, ref: string | null, runId: number, callbackUrl: string, installationId: number }} r
 * @returns {Promise<{ id: string, created: boolean }>}
 */
export async function createRelease(env, r) {
  const id = newId();
  const inserted = await env.DB.prepare(
    `INSERT INTO releases (id, repo, product, environment, sha, ref, run_id, callback_url, installation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
  )
    .bind(
      id,
      r.repo,
      r.product,
      r.environment,
      r.sha,
      r.ref,
      r.runId,
      r.callbackUrl,
      r.installationId,
      new Date().toISOString(),
    )
    .first();
  if (inserted) return { id, created: true };
  const existing = await env.DB.prepare(
    "SELECT id FROM releases WHERE run_id = ? AND environment = ? AND state = 'pending'",
  )
    .bind(r.runId, r.environment)
    .first();
  return { id: String(existing?.id), created: false };
}

/**
 * @param {ReleaseEnv} env
 * @param {{ state?: ReleaseState, product?: string }} [filter]
 * @returns {Promise<Release[]>}
 */
export async function listReleases(env, { state, product } = {}) {
  const where = [state && "state = ?", product && "product = ?"].filter(Boolean);
  const { results } = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM releases ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(...[state, product].filter(value => value !== undefined))
    .all();
  return results.map(toRelease);
}

/**
 * @param {ReleaseEnv} env
 * @param {string} id
 * @returns {Promise<Release | null>}
 */
export async function getRelease(env, id) {
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM releases WHERE id = ?`).bind(id).first();
  return row ? toRelease(row) : null;
}

/**
 * Records the owner's decision, or GitHub's that the run no longer waits. Only a pending release can be decided.
 * @param {ReleaseEnv} env
 * @param {string} id
 * @param {"approved" | "rejected" | "expired"} decision
 * @param {string} actor
 * @param {string} [note]
 * @returns {Promise<Release>}
 */
export async function decideRelease(env, id, decision, actor, note) {
  const row = await env.DB.prepare(
    `UPDATE releases SET state = ?, note = ?, decided_at = ?, decided_by = ? WHERE id = ? AND state = 'pending' RETURNING id`,
  )
    .bind(decision, note ?? null, new Date().toISOString(), actor, id)
    .first();
  if (!row) throw new Error("release-not-pending");
  await recordAudit(env, { actor, action: `release.${decision}`, targetType: "release", targetId: id });
  return /** @type {Release} */ (await getRelease(env, id));
}

/**
 * Spends the newest approved release for exactly this run, so it yields one credential and no more.
 * @param {ReleaseEnv} env
 * @param {{ repo: string, environment: string, sha: string, runId: number }} match
 * @returns {Promise<Release | null>}
 */
export async function spendRelease(env, match) {
  const row = await env.DB.prepare(
    `UPDATE releases SET state = 'spent', spent_at = ?
     WHERE id = (SELECT id FROM releases WHERE state = 'approved' AND lower(repo) = lower(?) AND environment = ? AND sha = ? AND run_id = ?
                 ORDER BY created_at DESC, id DESC LIMIT 1)
     RETURNING id`,
  )
    .bind(new Date().toISOString(), match.repo, match.environment, match.sha, match.runId)
    .first();
  return row ? getRelease(env, String(row.id)) : null;
}
