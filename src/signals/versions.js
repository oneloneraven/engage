import { log } from "../lib/log.js";

const TIMEOUT_MS = 3_000;
const ENVIRONMENTS = new Set(["production", "beta"]);
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;

/**
 * @typedef {{ DB: import("../lib/db.js").Database, APP_ENV?: string, RELEASE_VERSION?: string }} VersionsEnv
 * @typedef {{ name: string, healthUrl: string }} Environment
 */

/**
 * @param {unknown} raw
 * @returns {Environment[]}
 */
function environmentsOf(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      entry =>
        ENVIRONMENTS.has(entry?.name) &&
        typeof entry.healthUrl === "string" &&
        URL.canParse(entry.healthUrl) &&
        new URL(entry.healthUrl).protocol === "https:",
    );
  } catch {
    return [];
  }
}

/**
 * The version a health endpoint reports, or null when it can't be trusted. It's shown in the UI, so it's held to a
 * short, plain pattern.
 * @param {string} url
 * @returns {Promise<string | null>}
 */
async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = /** @type {{ version?: unknown }} */ (await response.json());
    return typeof body.version === "string" && VERSION.test(body.version) ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * Reads each product environment's health endpoint and records its version. A failed probe leaves the row as it was,
 * so a beta that's briefly down keeps its version and "since".
 * @param {VersionsEnv} env
 * @param {Date} now
 */
export async function refreshVersions(env, now) {
  const products = await env.DB.prepare("SELECT slug, environments FROM products ORDER BY slug").all();
  const targets = products.results.flatMap(row =>
    environmentsOf(row.environments).map(environment => ({ product: String(row.slug), ...environment })),
  );
  const seen = await Promise.all(targets.map(async target => ({ ...target, version: await probe(target.healthUrl) })));

  const at = now.toISOString();
  const upsert = env.DB.prepare(
    `INSERT INTO deployed_versions (product, environment, version, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (product, environment) DO UPDATE SET
       first_seen = CASE WHEN deployed_versions.version = excluded.version THEN deployed_versions.first_seen
                         ELSE excluded.first_seen END,
       version = excluded.version, last_seen = excluded.last_seen`,
  );
  const statements = [];
  for (const { product, name, version } of seen) {
    if (version === null) {
      log(env, "warn", "versions.probe-failed", { product });
      continue;
    }
    statements.push(upsert.bind(product, name, version, at, at));
  }
  if (statements.length) await env.DB.batch(statements);
}
