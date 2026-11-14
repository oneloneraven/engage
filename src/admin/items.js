import { recordAudit } from "../audit.js";

/**
 * @typedef {{
 *   id: string,
 *   product: string,
 *   kind: "issue" | "feedback" | "email",
 *   source: "web" | "app" | "email",
 *   subject: string | null,
 *   contactEmail: string | null,
 *   contactName: string | null,
 *   readAt: string | null,
 *   starred: boolean,
 *   junk: boolean,
 *   suspectedSpam: boolean,
 *   archivedAt: string | null,
 *   replyOwedAt: string | null,
 *   issueNumber: number | null,
 *   issueUrl: string | null,
 *   messageCount: number,
 *   createdAt: string,
 *   lastActivityAt: string,
 * }} ItemSummary
 */

/**
 * @typedef {ItemSummary & {
 *   quoteConsent: boolean,
 *   credit: "name" | "initials" | "anonymous" | null,
 *   sourcePage: string | null,
 *   section: string | null,
 *   appVersion: string | null,
 *   context: Record<string, unknown> | null,
 *   accountRef: string | null,
 *   authResult: { spf: string, dkim: string, dmarc: string } | null,
 *   messages: { id: string, direction: "in" | "out", fromAddr: string | null, bodyText: string, hasHtml: boolean, rfcMessageId: string | null, createdAt: string }[],
 *   attachments: { id: string, messageId: string, filename: string | null, contentType: string | null, size: number }[],
 *   testimonials: { id: string, product: string, excerpt: string, attribution: string, approvedAt: string | null, withdrawnAt: string | null, createdAt: string }[],
 * }} ItemDetail
 */

/** @typedef {"new" | "open" | "archived" | "starred" | "junk" | "reply-owed"} ItemState */

/**
 * @typedef {{
 *   product?: string,
 *   kind?: string,
 *   state?: ItemState,
 *   hasIssue?: boolean,
 *   q?: string,
 *   cursor?: string,
 *   limit?: number,
 * }} ItemFilters
 */

/** @typedef {{ read?: boolean, starred?: boolean, archived?: boolean, junk?: boolean, replyOwed?: false }} FlagChange */

/** @typedef {{ DB: import("../lib/db.js").Database }} ItemsEnv */
/** @typedef {ItemsEnv & { ATTACHMENTS: { delete: (key: string) => Promise<unknown> } }} DeleteEnv */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const NEW = "read_at IS NULL AND junk = 0 AND archived_at IS NULL";
const OPEN = "read_at IS NOT NULL AND archived_at IS NULL AND junk = 0";

/** @type {Record<ItemState, string>} */
const STATE_CLAUSES = {
  new: NEW,
  open: OPEN,
  archived: "archived_at IS NOT NULL AND junk = 0",
  starred: "starred = 1 AND junk = 0",
  junk: "junk = 1",
  "reply-owed": "reply_owed_at IS NOT NULL AND junk = 0",
};

const SUMMARY_COLUMNS =
  "id, product, kind, source, subject, contact_email, contact_name, read_at, starred, junk, suspected_spam, archived_at, reply_owed_at, issue_number, issue_url, created_at, last_activity_at, (SELECT COUNT(*) FROM messages WHERE messages.item_id = items.id) AS message_count";

/** @param {string} term */
const escapeLike = term => term.replace(/[\\%_]/g, "\\$&");

/**
 * @param {Record<string, unknown>} row
 * @returns {ItemSummary}
 */
function toSummary(row) {
  return {
    id: String(row.id),
    product: String(row.product),
    kind: /** @type {ItemSummary["kind"]} */ (row.kind),
    source: /** @type {ItemSummary["source"]} */ (row.source),
    subject: /** @type {string | null} */ (row.subject),
    contactEmail: /** @type {string | null} */ (row.contact_email),
    contactName: /** @type {string | null} */ (row.contact_name),
    readAt: /** @type {string | null} */ (row.read_at),
    starred: row.starred === 1,
    junk: row.junk === 1,
    suspectedSpam: row.suspected_spam === 1,
    archivedAt: /** @type {string | null} */ (row.archived_at),
    replyOwedAt: /** @type {string | null} */ (row.reply_owed_at),
    issueNumber: /** @type {number | null} */ (row.issue_number),
    issueUrl: /** @type {string | null} */ (row.issue_url),
    messageCount: Number(row.message_count),
    createdAt: String(row.created_at),
    lastActivityAt: String(row.last_activity_at),
  };
}

/** @param {{ lastActivityAt: string, id: string }} last */
const encodeCursor = last =>
  btoa(JSON.stringify([last.lastActivityAt, last.id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * @param {string} cursor
 * @returns {[string, string]}
 */
function decodeCursor(cursor) {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(padded));
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(part => typeof part === "string")) {
      return [parsed[0], parsed[1]];
    }
  } catch {}
  throw new Error("bad-cursor");
}

/**
 * @param {ItemsEnv} env
 * @param {ItemFilters} filters
 * @returns {Promise<{ items: ItemSummary[], next: string | null }>}
 */
export async function listItems(env, filters) {
  const where = [];
  /** @type {unknown[]} */
  const binds = [];
  if (filters.product !== undefined) {
    where.push("product = ?");
    binds.push(filters.product);
  }
  if (filters.kind !== undefined) {
    where.push("kind = ?");
    binds.push(filters.kind);
  }
  where.push(filters.state === undefined ? "junk = 0" : STATE_CLAUSES[filters.state]);
  if (filters.hasIssue !== undefined)
    where.push(filters.hasIssue ? "issue_number IS NOT NULL" : "issue_number IS NULL");
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    where.push(
      "(subject LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM messages WHERE messages.item_id = items.id AND messages.body_text LIKE ? ESCAPE '\\'))",
    );
    binds.push(pattern, pattern);
  }
  if (filters.cursor !== undefined) {
    const [lastActivityAt, id] = decodeCursor(filters.cursor);
    where.push("(last_activity_at < ? OR (last_activity_at = ? AND id < ?))");
    binds.push(lastActivityAt, lastActivityAt, id);
  }
  const requested = filters.limit ?? DEFAULT_LIMIT;
  const limit = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
  const { results } = await env.DB.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM items WHERE ${where.join(" AND ")} ORDER BY last_activity_at DESC, id DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all();
  const items = results.slice(0, limit).map(toSummary);
  const next = results.length > limit ? encodeCursor(items[items.length - 1]) : null;
  return { items, next };
}

/** @param {unknown} value */
const parseJson = value => (value === null || value === undefined ? null : JSON.parse(String(value)));

/**
 * @param {ItemsEnv} env
 * @param {string} id
 * @returns {Promise<ItemDetail | null>}
 */
export async function getItem(env, id) {
  const row = await env.DB.prepare(
    `SELECT *, (SELECT COUNT(*) FROM messages WHERE item_id = ?1) AS message_count FROM items WHERE id = ?1`,
  )
    .bind(id)
    .first();
  if (!row) return null;
  const [messages, attachments, testimonials] = await Promise.all([
    env.DB.prepare(
      "SELECT id, direction, from_addr, body_text, body_html IS NOT NULL AS has_html, rfc_message_id, created_at FROM messages WHERE item_id = ? ORDER BY created_at, id",
    )
      .bind(id)
      .all(),
    env.DB.prepare("SELECT id, message_id, filename, content_type, size FROM attachments WHERE item_id = ? ORDER BY id")
      .bind(id)
      .all(),
    env.DB.prepare(
      "SELECT id, product, excerpt, attribution, approved_at, withdrawn_at, created_at FROM testimonials WHERE item_id = ? ORDER BY created_at, id",
    )
      .bind(id)
      .all(),
  ]);
  return {
    ...toSummary(row),
    quoteConsent: row.quote_consent === 1,
    credit: /** @type {ItemDetail["credit"]} */ (row.credit),
    sourcePage: /** @type {string | null} */ (row.source_page),
    section: /** @type {string | null} */ (row.section),
    appVersion: /** @type {string | null} */ (row.app_version),
    context: parseJson(row.context),
    accountRef: /** @type {string | null} */ (row.account_ref),
    authResult: parseJson(row.auth_result),
    messages: messages.results.map(message => ({
      id: String(message.id),
      direction: /** @type {"in" | "out"} */ (message.direction),
      fromAddr: /** @type {string | null} */ (message.from_addr),
      bodyText: String(message.body_text),
      hasHtml: message.has_html === 1,
      rfcMessageId: /** @type {string | null} */ (message.rfc_message_id),
      createdAt: String(message.created_at),
    })),
    attachments: attachments.results.map(attachment => ({
      id: String(attachment.id),
      messageId: String(attachment.message_id),
      filename: /** @type {string | null} */ (attachment.filename),
      contentType: /** @type {string | null} */ (attachment.content_type),
      size: Number(attachment.size),
    })),
    testimonials: testimonials.results.map(testimonial => ({
      id: String(testimonial.id),
      product: String(testimonial.product),
      excerpt: String(testimonial.excerpt),
      attribution: String(testimonial.attribution),
      approvedAt: /** @type {string | null} */ (testimonial.approved_at),
      withdrawnAt: /** @type {string | null} */ (testimonial.withdrawn_at),
      createdAt: String(testimonial.created_at),
    })),
  };
}

/**
 * @param {ItemsEnv} env
 * @param {string} id
 * @param {FlagChange} change
 * @param {string} actor
 * @returns {Promise<void>}
 */
export async function setFlags(env, id, change, actor) {
  if (/** @type {unknown} */ (change.replyOwed) === true) throw new Error("reply-owed-not-settable");
  const item = await env.DB.prepare("SELECT read_at, starred, archived_at, junk, reply_owed_at FROM items WHERE id = ?")
    .bind(id)
    .first();
  if (!item) throw new Error("not-found");

  const now = new Date().toISOString();
  /** @type {string[]} */
  const assignments = [];
  /** @type {unknown[]} */
  const values = [];
  /** @type {string[]} */
  const actions = [];

  /**
   * @param {string} column
   * @param {boolean | undefined} wanted
   * @param {boolean} current
   * @param {unknown} onValue
   * @param {unknown} offValue
   * @param {[string, string]} names
   */
  const apply = (column, wanted, current, onValue, offValue, names) => {
    if (wanted === undefined || wanted === current) return;
    assignments.push(`${column} = ?`);
    values.push(wanted ? onValue : offValue);
    actions.push(wanted ? names[0] : names[1]);
  };

  apply("read_at", change.read, item.read_at !== null, now, null, ["item.read", "item.unread"]);
  apply("starred", change.starred, item.starred === 1, 1, 0, ["item.starred", "item.unstarred"]);
  apply("archived_at", change.archived, item.archived_at !== null, now, null, ["item.archived", "item.unarchived"]);
  apply("junk", change.junk, item.junk === 1, 1, 0, ["item.junk", "item.not-junk"]);
  if (change.replyOwed === false && item.reply_owed_at !== null) {
    assignments.push("reply_owed_at = ?");
    values.push(null);
    actions.push("item.reply-owed-dismissed");
  }
  if (assignments.length === 0) return;

  await env.DB.prepare(`UPDATE items SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();
  for (const action of actions) await recordAudit(env, { actor, action, targetType: "item", targetId: id, detail: {} });
}

/**
 * @param {DeleteEnv} env
 * @param {string} id
 * @param {string} actor
 * @param {{ beforeDelete?: (env: DeleteEnv, itemId: string, actor: string) => Promise<void> }} [options]
 * @returns {Promise<void>}
 */
export async function deleteItem(env, id, actor, options = {}) {
  const item = await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(id).first();
  if (!item) throw new Error("not-found");
  if (options.beforeDelete) await options.beforeDelete(env, id, actor);
  const { results } = await env.DB.prepare("SELECT r2_key FROM attachments WHERE item_id = ?").bind(id).all();
  for (const attachment of results) await env.ATTACHMENTS.delete(String(attachment.r2_key));
  await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  await recordAudit(env, { actor, action: "item.deleted", targetType: "item", targetId: id, detail: {} });
}

/**
 * @param {ItemsEnv} env
 * @returns {Promise<{ new: number, open: number, replyOwed: number, byProduct: Record<string, { new: number, open: number }> }>}
 */
export async function counts(env) {
  const [perProduct, owed] = await Promise.all([
    env.DB.prepare(
      `SELECT products.slug AS slug,
        COALESCE(SUM(CASE WHEN ${NEW} THEN 1 ELSE 0 END), 0) AS new_count,
        COALESCE(SUM(CASE WHEN ${OPEN} THEN 1 ELSE 0 END), 0) AS open_count
      FROM products LEFT JOIN items ON items.product = products.slug
      GROUP BY products.slug ORDER BY products.slug`,
    ).all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE reply_owed_at IS NOT NULL AND junk = 0").first(),
  ]);
  /** @type {Record<string, { new: number, open: number }>} */
  const byProduct = {};
  let totalNew = 0;
  let totalOpen = 0;
  for (const row of perProduct.results) {
    const entry = { new: Number(row.new_count), open: Number(row.open_count) };
    byProduct[String(row.slug)] = entry;
    totalNew += entry.new;
    totalOpen += entry.open;
  }
  return { new: totalNew, open: totalOpen, replyOwed: Number(owed?.n ?? 0), byProduct };
}
