import { deleteItem } from "../admin/items.js";
import { recordAudit } from "../audit.js";
import { dispatch } from "../github/app.js";
import { notFound } from "../lib/http.js";
import { newId } from "../lib/ids.js";
import { log } from "../lib/log.js";
import { getProduct } from "../registry.js";
import { isFaithfulExcerpt } from "./excerpt.js";

/**
 * @typedef {import("../github/app.js").GithubEnv & {
 *   DB: import("../lib/db.js").Database,
 *   APP_ENV?: string,
 *   RELEASE_VERSION?: string,
 * }} TestimonialsEnv
 */

const ANONYMOUS = "Anonymous";

/**
 * @param {"name" | "initials" | "anonymous" | null} credit
 * @param {string | null} contactName
 */
function attributionFor(credit, contactName) {
  const name = (contactName ?? "").trim();
  if (name === "") return ANONYMOUS;
  if (credit === "name") return name;
  if (credit === "initials") {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map(word => `${[...word][0].toUpperCase()}.`)
      .join(" ");
  }
  return ANONYMOUS;
}

/**
 * @param {TestimonialsEnv} env
 * @param {string} slug
 */
async function rebuildSite(env, slug) {
  const product = await getProduct(env, slug);
  if (!product?.siteRepo || !product.siteDispatchEvent) return;
  try {
    await dispatch(env, product.siteRepo, product.siteDispatchEvent);
  } catch (error) {
    log(env, "error", "testimonials.dispatch-failed", {
      errorName: error instanceof Error ? error.name : "Error",
      product: slug,
    });
  }
}

/**
 * @param {TestimonialsEnv} env
 * @param {string} itemId
 * @param {string} excerpt
 * @param {string} actor
 * @returns {Promise<{ id: string }>}
 */
export async function createExcerpt(env, itemId, excerpt, actor) {
  const item = await env.DB.prepare("SELECT product, kind, quote_consent, credit, contact_name FROM items WHERE id = ?")
    .bind(itemId)
    .first();
  if (!item) throw new Error("not-found");
  if (item.kind !== "feedback" || item.quote_consent !== 1) throw new Error("no-consent");
  const message = await env.DB.prepare(
    "SELECT body_text FROM messages WHERE item_id = ? AND direction = 'in' ORDER BY created_at, id LIMIT 1",
  )
    .bind(itemId)
    .first();
  const trimmed = excerpt.trim();
  if (!message || !isFaithfulExcerpt(String(message.body_text), trimmed)) throw new Error("not-faithful");
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO testimonials (id, item_id, product, excerpt, attribution, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      itemId,
      String(item.product),
      trimmed,
      attributionFor(
        /** @type {"name" | "initials" | "anonymous" | null} */ (item.credit),
        /** @type {string | null} */ (item.contact_name),
      ),
      new Date().toISOString(),
    )
    .run();
  await recordAudit(env, {
    actor,
    action: "testimonial.created",
    targetType: "testimonial",
    targetId: id,
    detail: { testimonialId: id },
  });
  return { id };
}

/**
 * @param {TestimonialsEnv} env
 * @param {string} id
 * @param {string} actor
 * @param {"approved" | "withdrawn"} state
 */
async function setState(env, id, actor, state) {
  const row = await env.DB.prepare("SELECT product FROM testimonials WHERE id = ?").bind(id).first();
  if (!row) throw new Error("not-found");
  const now = new Date().toISOString();
  await env.DB.prepare(
    state === "approved"
      ? "UPDATE testimonials SET approved_at = ?, withdrawn_at = NULL WHERE id = ?"
      : "UPDATE testimonials SET withdrawn_at = ? WHERE id = ?",
  )
    .bind(now, id)
    .run();
  await recordAudit(env, {
    actor,
    action: `testimonial.${state}`,
    targetType: "testimonial",
    targetId: id,
    detail: { testimonialId: id },
  });
  await rebuildSite(env, String(row.product));
}

/**
 * @param {TestimonialsEnv} env
 * @param {string} id
 * @param {string} actor
 * @returns {Promise<void>}
 */
export const approve = (env, id, actor) => setState(env, id, actor, "approved");

/**
 * @param {TestimonialsEnv} env
 * @param {string} id
 * @param {string} actor
 * @returns {Promise<void>}
 */
export const withdraw = (env, id, actor) => setState(env, id, actor, "withdrawn");

/**
 * @param {TestimonialsEnv} env
 * @param {string} itemId
 * @param {string} actor
 * @returns {Promise<void>}
 */
export async function withdrawAllForItem(env, itemId, actor) {
  const { results } = await env.DB.prepare(
    "SELECT id, product FROM testimonials WHERE item_id = ? AND approved_at IS NOT NULL AND withdrawn_at IS NULL",
  )
    .bind(itemId)
    .all();
  const now = new Date().toISOString();
  for (const row of results) {
    await env.DB.prepare("UPDATE testimonials SET withdrawn_at = ? WHERE id = ?").bind(now, row.id).run();
    await recordAudit(env, {
      actor,
      action: "testimonial.withdrawn",
      targetType: "testimonial",
      targetId: String(row.id),
      detail: { testimonialId: String(row.id) },
    });
  }
  for (const slug of new Set(results.map(row => String(row.product)))) await rebuildSite(env, slug);
}

/**
 * @param {TestimonialsEnv & import("../admin/items.js").DeleteEnv} env
 * @param {string} id
 * @param {string} actor
 * @returns {Promise<void>}
 */
export function deleteItemWithTestimonials(env, id, actor) {
  return deleteItem(env, id, actor, { beforeDelete: withdrawAllForItem });
}

/**
 * @param {TestimonialsEnv} env
 * @param {string} slug
 * @returns {Promise<Response>}
 */
export async function publicFeed(env, slug) {
  const product = await getProduct(env, slug);
  if (!product?.testimonialsEnabled) return notFound();
  const { results } = await env.DB.prepare(
    `SELECT excerpt, attribution, approved_at FROM testimonials
     WHERE product = ? AND approved_at IS NOT NULL AND withdrawn_at IS NULL
     ORDER BY approved_at DESC, id DESC`,
  )
    .bind(slug)
    .all();
  return Response.json(
    results.map(row => ({
      text: String(row.excerpt),
      attribution: String(row.attribution),
      date: String(row.approved_at).slice(0, 10),
    })),
    { headers: { "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" } },
  );
}
