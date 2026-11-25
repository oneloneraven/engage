/**
 * @typedef {{ repo: string, product: string, environments: string[], tokenPolicy: Record<string, unknown> }} GatedRepo
 */

/**
 * The gate's entry for a repository, or null when Engage doesn't gate it. Repository names compare case-insensitively.
 * @param {{ DB: import("../lib/db.js").Database }} env
 * @param {string} repo
 * @returns {Promise<GatedRepo | null>}
 */
export async function gatedRepo(env, repo) {
  const row = await env.DB.prepare("SELECT * FROM release_repos WHERE lower(repo) = lower(?)").bind(repo).first();
  if (!row) return null;
  return {
    repo: String(row.repo),
    product: String(row.product),
    environments: JSON.parse(String(row.environments)),
    tokenPolicy: JSON.parse(String(row.token_policy)),
  };
}
