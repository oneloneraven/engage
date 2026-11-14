import { log } from "./lib/log.js";
import { deleteItemWithTestimonials } from "./testimonials/testimonials.js";

/**
 * @typedef {import("./testimonials/testimonials.js").TestimonialsEnv
 *   & import("./admin/items.js").DeleteEnv} RetentionEnv
 */

const ACTOR = "system:retention";
const JUNK_DAYS = 30;
const MAX_DELETIONS = 500;
const DAY_MS = 86_400_000;

/**
 * Calendar months back in UTC, with the day clamped to the end of the target month.
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
export function subtractMonths(date, months) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/**
 * Deletes items past their retention period, oldest first, at most 500 per run.
 * @param {RetentionEnv} env
 * @param {Date} now
 * @returns {Promise<{ deleted: number, failed: number }>}
 */
export async function runRetention(env, now) {
  const { results: products } = await env.DB.prepare("SELECT DISTINCT retention_months FROM products").all();
  const cutoffs = products.map(row => ({
    months: Number(row.retention_months),
    cutoff: subtractMonths(now, Number(row.retention_months)).toISOString(),
  }));
  const junkCutoff = new Date(now.getTime() - JUNK_DAYS * DAY_MS).toISOString();

  const { results: due } = await env.DB.prepare(
    `SELECT items.id AS id,
       CASE WHEN items.junk = 1 THEN items.created_at
            WHEN items.archived_at IS NOT NULL THEN items.archived_at
            ELSE items.last_activity_at END AS reference
     FROM items
     JOIN products ON products.slug = items.product
     JOIN json_each(?) AS cutoffs ON json_extract(cutoffs.value, '$.months') = products.retention_months
     WHERE reference < CASE WHEN items.junk = 1 THEN ? ELSE json_extract(cutoffs.value, '$.cutoff') END
     ORDER BY reference, items.id
     LIMIT ?`,
  )
    .bind(JSON.stringify(cutoffs), junkCutoff, MAX_DELETIONS)
    .all();

  let deleted = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await deleteItemWithTestimonials(env, String(row.id), ACTOR);
      deleted++;
    } catch (error) {
      failed++;
      log(env, "error", "retention.delete-failed", { errorName: error instanceof Error ? error.name : "Error" });
    }
  }
  return { deleted, failed };
}
