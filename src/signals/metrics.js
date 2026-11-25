import { log } from "../lib/log.js";
import * as clUsage from "./sources/cl-usage.js";
import * as githubDownloads from "./sources/github-downloads.js";
import * as webVisits from "./sources/web-visits.js";

const DAY_MS = 86_400_000;
const LOOK_BACK_DAYS = 30;
const METRIC = /^[a-z0-9-]{1,40}$/;

/**
 * @typedef {{ ready: (env: any) => boolean, canLookBack: boolean, read: (env: any, config: any, day: string) => Promise<unknown> }} Source
 * @typedef {{ DB: import("../lib/db.js").Database, APP_ENV?: string, RELEASE_VERSION?: string }
 *   & import("./sources/web-visits.js").WebVisitsEnv
 *   & import("./sources/cl-usage.js").ClUsageEnv
 *   & import("./sources/github-downloads.js").DownloadsEnv} MetricsEnv
 * @typedef {{ source: string, metric: string } & Record<string, unknown>} EngagementEntry
 */

/** @type {Record<string, Source>} */
const SOURCES = { "web-visits": webVisits, "cl-usage": clUsage, "github-downloads": githubDownloads };

/** @param {Date} date */
const dayOf = date => date.toISOString().slice(0, 10);

/**
 * @param {unknown} raw
 * @returns {EngagementEntry[]}
 */
function entriesOf(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed)
      ? parsed.filter(entry => typeof entry?.source === "string" && METRIC.test(String(entry?.metric)))
      : [];
  } catch {
    return [];
  }
}

/**
 * Our own error codes are safe to log; anything else (a parse error quoting a body, say) logs only its name.
 * @param {unknown} error
 */
const codeOf = error =>
  error instanceof Error ? (/^[a-z0-9-]{1,40}$/.test(error.message) ? error.message : error.name) : "Error";

/** @param {unknown} value */
const isCount = value => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;

/**
 * The days to record: yesterday for a source that only knows the present, or every day of the last 30 that has no
 * snapshot yet for one that can look back.
 * @param {MetricsEnv} env
 * @param {string} product
 * @param {string} metric
 * @param {Source} source
 * @param {Date} now
 */
async function daysToRecord(env, product, metric, source, now) {
  const yesterday = new Date(Date.parse(dayOf(now)) - DAY_MS);
  if (!source.canLookBack) return [dayOf(yesterday)];
  const window = Array.from({ length: LOOK_BACK_DAYS }, (_, n) => dayOf(new Date(yesterday.getTime() - n * DAY_MS)));
  const have = await env.DB.prepare("SELECT day FROM metric_snapshots WHERE product = ? AND metric = ? AND day >= ?")
    .bind(product, metric, window[window.length - 1])
    .all();
  const recorded = new Set(have.results.map(row => String(row.day)));
  return window.filter(day => !recorded.has(day)).reverse();
}

/**
 * Runs each product's engagement plug-ins and writes one `metric_snapshots` row per product, metric and day. One
 * source failing, or missing its secrets, never stops the others.
 * @param {MetricsEnv} env
 * @param {Date} now
 */
export async function snapshotMetrics(env, now) {
  const products = await env.DB.prepare("SELECT slug, engagement FROM products ORDER BY slug").all();
  const upsert = env.DB.prepare(
    `INSERT INTO metric_snapshots (product, metric, day, value) VALUES (?, ?, ?, ?)
     ON CONFLICT (product, metric, day) DO UPDATE SET value = excluded.value`,
  );
  for (const row of products.results) {
    const product = String(row.slug);
    for (const entry of entriesOf(row.engagement)) {
      const source = SOURCES[entry.source];
      if (!source) {
        log(env, "warn", "metrics.unknown-source", { product });
        continue;
      }
      if (!source.ready(env)) {
        log(env, "warn", `metrics.${entry.source}.not-configured`, { product });
        continue;
      }
      const statements = [];
      for (const day of await daysToRecord(env, product, entry.metric, source, now)) {
        try {
          const value = await source.read(env, entry, day);
          if (!isCount(value)) throw new Error("not-a-count");
          statements.push(upsert.bind(product, entry.metric, day, value));
        } catch (error) {
          log(env, "warn", `metrics.${entry.source}.failed`, {
            product,
            errorName: codeOf(error),
          });
          break;
        }
      }
      if (statements.length) await env.DB.batch(statements);
    }
  }
}
