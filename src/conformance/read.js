const STALE_MS = 36 * 3_600_000;

/**
 * @typedef {{ status: string, reason: string, link: string | null }} StoredCell
 * @typedef {{ repo: string, name: string, product: string | null, checkedAt: string, stale: boolean, failing: number, cells: Record<string, StoredCell> }} RepositoryResult
 * @typedef {{ repo: string, name: string, failing: number, stale: boolean }} FailingRepository
 * @typedef {{
 *   lastRun: { finishedAt: string, rulesVersion: number | null, stale: boolean } | null,
 *   lastError: { at: string, error: string } | null,
 *   checks: { id: string, title: string }[],
 *   repositories: RepositoryResult[],
 * }} Conformance
 */

/** @param {string} iso @param {Date} now */
const isStale = (iso, now) => now.getTime() - Date.parse(iso) > STALE_MS;

/**
 * Which product each repository belongs to, by its lower-cased name, and the products' order.
 * @param {{ DB: import("../lib/db.js").Database }} env
 */
async function owners(env) {
  const [products, gated] = await Promise.all([
    env.DB.prepare("SELECT slug, issue_repo, site_repo FROM products ORDER BY slug").all(),
    env.DB.prepare("SELECT repo, product FROM release_repos").all(),
  ]);
  /** @type {Map<string, string>} */
  const byRepo = new Map();
  for (const row of products.results)
    for (const repo of [row.issue_repo, row.site_repo])
      if (repo) byRepo.set(String(repo).toLowerCase(), String(row.slug));
  for (const row of gated.results) byRepo.set(String(row.repo).toLowerCase(), String(row.product));
  return { byRepo, order: products.results.map(row => String(row.slug)) };
}

/**
 * Every repository's stored results, grouped by product in registry order and then those with no product.
 * @param {{ DB: import("../lib/db.js").Database }} env
 * @param {Date} now
 * @returns {Promise<Conformance>}
 */
export async function readConformance(env, now) {
  const [complete, latest, checks, results, { byRepo, order }] = await Promise.all([
    env.DB.prepare(
      "SELECT finished_at, rules_version FROM conformance_runs WHERE complete = 1 ORDER BY id DESC LIMIT 1",
    ).first(),
    env.DB.prepare("SELECT finished_at, error FROM conformance_runs ORDER BY id DESC LIMIT 1").first(),
    env.DB.prepare("SELECT id, title FROM conformance_checks ORDER BY position").all(),
    env.DB.prepare("SELECT repo, check_id, status, reason, link, checked_at FROM conformance_results").all(),
    owners(env),
  ]);
  /** @type {Map<string, RepositoryResult>} */
  const repositories = new Map();
  for (const row of results.results) {
    const repo = String(row.repo);
    const entry = repositories.get(repo) ?? {
      repo,
      name: repo.split("/").at(-1) ?? repo,
      product: byRepo.get(repo.toLowerCase()) ?? null,
      checkedAt: String(row.checked_at),
      stale: false,
      failing: 0,
      cells: {},
    };
    entry.cells[String(row.check_id)] = {
      status: String(row.status),
      reason: String(row.reason),
      link: row.link == null ? null : String(row.link),
    };
    if (String(row.checked_at) < entry.checkedAt) entry.checkedAt = String(row.checked_at);
    if (row.status === "fail") entry.failing++;
    repositories.set(repo, entry);
  }
  const rank = (/** @type {string | null} */ product) => (product === null ? order.length : order.indexOf(product));
  const sorted = [...repositories.values()]
    .map(entry => ({ ...entry, stale: isStale(entry.checkedAt, now) }))
    .sort((a, b) => rank(a.product) - rank(b.product) || a.name.localeCompare(b.name));
  return {
    lastRun: complete
      ? {
          finishedAt: String(complete.finished_at),
          rulesVersion: complete.rules_version == null ? null : Number(complete.rules_version),
          stale: isStale(String(complete.finished_at), now),
        }
      : null,
    lastError:
      latest?.error && latest.finished_at ? { at: String(latest.finished_at), error: String(latest.error) } : null,
    checks: checks.results.map(row => ({ id: String(row.id), title: String(row.title) })),
    repositories: sorted,
  };
}

/**
 * The repositories with a failing check, each once, by the product that owns them and with no product.
 * @param {{ DB: import("../lib/db.js").Database }} env
 * @param {Date} now
 * @returns {Promise<{ byProduct: Record<string, FailingRepository[]>, noProduct: FailingRepository[], total: number }>}
 */
export async function failingRepositories(env, now) {
  const { repositories } = await readConformance(env, now);
  /** @type {Record<string, FailingRepository[]>} */
  const byProduct = {};
  /** @type {FailingRepository[]} */
  const noProduct = [];
  let total = 0;
  for (const { repo, name, product, failing, stale } of repositories) {
    if (!failing) continue;
    total++;
    const entry = { repo, name, failing, stale };
    if (product === null) noProduct.push(entry);
    else byProduct[product] = [...(byProduct[product] ?? []), entry];
  }
  return { byProduct, noProduct, total };
}
