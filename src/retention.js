import { log } from "./lib/log.js";
import { deleteItemsWithTestimonials } from "./testimonials/testimonials.js";

/**
 * @typedef {import("./testimonials/testimonials.js").TestimonialsEnv
 *   & import("./admin/items.js").BulkDeleteEnv} RetentionEnv
 */

const ACTOR = "system:retention";
const JUNK_DAYS = 30;
const BATCH_SIZE = 100;
const MAX_BATCHES = 20;
const DAY_MS = 86_400_000;
const DUE = `SELECT items.id AS id,
    CASE WHEN items.junk = 1 THEN items.created_at
         WHEN items.archived_at IS NOT NULL THEN items.archived_at
         ELSE items.last_activity_at END AS reference
  FROM items
  JOIN products ON products.slug = items.product
  JOIN json_each(?) AS cutoffs ON json_extract(cutoffs.value, '$.months') = products.retention_months
  WHERE reference < CASE WHEN items.junk = 1 THEN ? ELSE json_extract(cutoffs.value, '$.cutoff') END
  ORDER BY reference, items.id
  LIMIT ?`;

/** @param {unknown} error */
const errorName = error => (error instanceof Error ? error.name : "Error");

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
 * Deletes items past their retention period, oldest first, in batches, so a backlog clears over runs inside D1's query limit; a failed batch is retried item by item and ends the run.
 * @param {RetentionEnv} env
 * @param {Date} now
 * @returns {Promise<{ deleted: number, failed: number }>}
 */
export async function runRetention(env, now) {
  const { results: products } = await env.DB.prepare("SELECT DISTINCT retention_months FROM products").all();
  const cutoffs = JSON.stringify(
    products.map(row => ({
      months: Number(row.retention_months),
      cutoff: subtractMonths(now, Number(row.retention_months)).toISOString(),
    })),
  );
  const junkCutoff = new Date(now.getTime() - JUNK_DAYS * DAY_MS).toISOString();

  let deleted = 0;
  let failed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { results: due } = await env.DB.prepare(DUE).bind(cutoffs, junkCutoff, BATCH_SIZE).all();
    const ids = due.map(row => String(row.id));
    if (ids.length === 0) break;
    try {
      await deleteItemsWithTestimonials(env, ids, ACTOR);
      deleted += ids.length;
    } catch (error) {
      log(env, "warn", "retention.batch-failed", { errorName: errorName(error) });
      for (const id of ids) {
        try {
          await deleteItemsWithTestimonials(env, [id], ACTOR);
          deleted++;
        } catch (itemError) {
          failed++;
          log(env, "error", "retention.delete-failed", { errorName: errorName(itemError) });
        }
      }
      break;
    }
    if (ids.length < BATCH_SIZE) break;
  }
  return { deleted, failed };
}
