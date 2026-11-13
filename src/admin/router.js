import * as v from "valibot";
import { recordAudit } from "../audit.js";
import { sendReply } from "../email/outbound.js";
import { createIssue } from "../github/app.js";
import { issueDraft } from "../github/issue-draft.js";
import { json, notFound } from "../lib/http.js";
import { log } from "../lib/log.js";
import { codePointLength } from "../lib/text.js";
import { getProduct } from "../registry.js";
import { approve, createExcerpt, deleteItemWithTestimonials, withdraw } from "../testimonials/testimonials.js";
import { counts, getItem, listItems, setFlags } from "./items.js";

/** @typedef {import("../worker.js").Env} Env */
/** @typedef {import("../worker.js").Context} Context */
/** @typedef {{ email: string }} Identity */

/**
 * @typedef {{
 *   request: Request,
 *   env: Env,
 *   actor: string,
 *   params: string[],
 *   url: URL,
 * }} RouteContext
 */

const CLIENT_ERRORS = {
  "not-found": 404,
  "no-contact": 409,
  "issue-exists": 409,
  "no-consent": 409,
  "not-faithful": 409,
  "repo-not-registered": 400,
  "bad-cursor": 400,
  "bad-request": 400,
  "reply-secret-missing": 502,
  "github-app-not-configured": 502,
  "send-failed": 502,
};

const ATTACHMENT_FALLBACK_TYPE = "application/octet-stream";
const MEDIA_TYPE = /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/;
const FILENAME_MAX = 100;

/**
 * @param {number} min
 * @param {number} max
 */
const trimmedText = (min, max) =>
  v.pipe(
    v.string(),
    v.trim(),
    v.check(value => codePointLength(value) >= min),
    v.check(value => codePointLength(value) <= max),
  );

const flagsSchema = v.strictObject({
  read: v.optional(v.boolean()),
  starred: v.optional(v.boolean()),
  archived: v.optional(v.boolean()),
  junk: v.optional(v.boolean()),
  replyOwed: v.optional(v.literal(false)),
});
const replySchema = v.strictObject({ text: trimmedText(1, 10_000) });
const issueSchema = v.strictObject({
  repo: v.pipe(v.string(), v.maxLength(140)),
  title: trimmedText(1, 256),
  body: trimmedText(1, 65_000),
  labels: v.pipe(v.array(v.pipe(v.string(), v.maxLength(50))), v.maxLength(10)),
});
const excerptSchema = v.strictObject({ excerpt: trimmedText(1, 2000) });
const blocklistSchema = v.strictObject({
  pattern: v.pipe(
    v.string(),
    v.maxLength(254),
    v.regex(/^[^\s@]*@[^\s@]+\.[^\s@]+$/),
    v.check(pattern => pattern === pattern.toLowerCase()),
  ),
});
const querySchema = v.object({
  product: v.optional(v.pipe(v.string(), v.maxLength(64))),
  kind: v.optional(v.picklist(["issue", "feedback", "email"])),
  state: v.optional(v.picklist(["new", "open", "archived", "starred", "junk", "reply-owed"])),
  hasIssue: v.optional(v.picklist(["true", "false"])),
  q: v.optional(v.pipe(v.string(), v.maxLength(200))),
  cursor: v.optional(v.pipe(v.string(), v.maxLength(500))),
  limit: v.optional(v.pipe(v.string(), v.regex(/^\d{1,4}$/))),
});

/**
 * @param {Request} request
 * @returns {Promise<unknown>}
 */
async function readJson(request) {
  const type = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new Error("bad-request");
  try {
    return await request.json();
  } catch {
    throw new Error("bad-request");
  }
}

/**
 * @template {v.GenericSchema} S
 * @param {S} schema
 * @param {unknown} input
 * @returns {v.InferOutput<S>}
 */
function parse(schema, input) {
  const result = v.safeParse(schema, input);
  if (!result.success) throw new Error("bad-request");
  return result.output;
}

/**
 * @template {v.GenericSchema} S
 * @param {S} schema
 * @param {Request} request
 */
async function bodyOf(schema, request) {
  return parse(schema, await readJson(request));
}

/** @param {string} id */
async function requireItem(env, id) {
  const item = await getItem(env, id);
  if (!item) throw new Error("not-found");
  return item;
}

/** @param {string} filename */
function safeFilename(filename) {
  const cleaned = [...filename.replace(/[^A-Za-z0-9._ -]/g, "_")].slice(0, FILENAME_MAX).join("").replace(/^\.+/, "");
  return cleaned.trim() === "" ? "attachment" : cleaned;
}

/** @param {RouteContext} context */
async function itemsList({ env, url }) {
  const query = parse(querySchema, Object.fromEntries(url.searchParams));
  const { hasIssue, limit, ...rest } = query;
  return json(
    await listItems(env, {
      ...rest,
      ...(hasIssue !== undefined && { hasIssue: hasIssue === "true" }),
      ...(limit !== undefined && { limit: Number(limit) }),
    }),
  );
}

/** @param {RouteContext} context */
async function itemRead({ env, actor, params: [id] }) {
  const item = await requireItem(env, id);
  if (item.readAt !== null) return json(item);
  await setFlags(env, id, { read: true }, actor);
  return json(await requireItem(env, id));
}

/** @param {RouteContext} context */
async function itemPatch({ env, actor, request, params: [id] }) {
  const change = await bodyOf(flagsSchema, request);
  await setFlags(env, id, change, actor);
  return json(await requireItem(env, id));
}

/** @param {RouteContext} context */
async function itemDelete({ env, actor, params: [id] }) {
  await deleteItemWithTestimonials(env, id, actor);
  return json({ ok: true });
}

/** @param {RouteContext} context */
async function replyCreate({ env, actor, request, params: [id] }) {
  const { text } = await bodyOf(replySchema, request);
  const item = await requireItem(env, id);
  const product = await getProduct(env, item.product);
  if (!product) throw new Error("not-found");
  return json(await sendReply(env, item, product, text, actor), 201);
}

/** @param {RouteContext} context */
async function draftRead({ env, params: [id] }) {
  const item = await requireItem(env, id);
  const product = await getProduct(env, item.product);
  if (!product) throw new Error("not-found");
  return json(issueDraft(item, product));
}

/** @param {RouteContext} context */
async function issueCreate({ env, actor, request, params: [id] }) {
  const draft = await bodyOf(issueSchema, request);
  return json(await createIssue(env, id, draft, actor), 201);
}

/** @param {RouteContext} context */
async function excerptCreate({ env, actor, request, params: [id] }) {
  const { excerpt } = await bodyOf(excerptSchema, request);
  return json(await createExcerpt(env, id, excerpt, actor), 201);
}

/** @param {RouteContext} context */
async function testimonialApprove({ env, actor, params: [id] }) {
  await approve(env, id, actor);
  return json({ ok: true });
}

/** @param {RouteContext} context */
async function testimonialWithdraw({ env, actor, params: [id] }) {
  await withdraw(env, id, actor);
  return json({ ok: true });
}

/** @param {RouteContext} context */
async function blocklistAdd({ env, actor, request }) {
  const { pattern } = await bodyOf(blocklistSchema, request);
  const result = await env.DB.prepare("INSERT OR IGNORE INTO blocklist (pattern, created_at) VALUES (?, ?)")
    .bind(pattern, new Date().toISOString())
    .run();
  if (result.meta.changes > 0) {
    await recordAudit(env, {
      actor,
      action: "blocklist.added",
      targetType: "blocklist",
      targetId: "blocklist",
      detail: {},
    });
  }
  return json({ ok: true });
}

/** @param {RouteContext} context */
async function countsRead({ env }) {
  return json(await counts(env));
}

/** @param {RouteContext} context */
async function attachmentRead({ env, params: [itemId, attachmentId] }) {
  const row = await env.DB.prepare(
    "SELECT r2_key, filename, content_type FROM attachments WHERE id = ? AND item_id = ?",
  )
    .bind(attachmentId, itemId)
    .first();
  if (!row) return notFound();
  const object = await env.ATTACHMENTS.get(String(row.r2_key));
  if (!object) return notFound();
  const type =
    typeof row.content_type === "string" && MEDIA_TYPE.test(row.content_type)
      ? row.content_type
      : ATTACHMENT_FALLBACK_TYPE;
  return new Response(object.body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${safeFilename(String(row.filename ?? ""))}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

/** @type {{ pattern: RegExp, handlers: Record<string, (context: RouteContext) => Promise<Response>> }[]} */
const ROUTES = [
  { pattern: /^\/api\/items$/, handlers: { GET: itemsList } },
  { pattern: /^\/api\/items\/([^/]+)$/, handlers: { GET: itemRead, PATCH: itemPatch, DELETE: itemDelete } },
  { pattern: /^\/api\/items\/([^/]+)\/replies$/, handlers: { POST: replyCreate } },
  { pattern: /^\/api\/items\/([^/]+)\/issue-draft$/, handlers: { GET: draftRead } },
  { pattern: /^\/api\/items\/([^/]+)\/issue$/, handlers: { POST: issueCreate } },
  { pattern: /^\/api\/items\/([^/]+)\/testimonials$/, handlers: { POST: excerptCreate } },
  { pattern: /^\/api\/items\/([^/]+)\/attachments\/([^/]+)$/, handlers: { GET: attachmentRead } },
  { pattern: /^\/api\/testimonials\/([^/]+)\/approve$/, handlers: { POST: testimonialApprove } },
  { pattern: /^\/api\/testimonials\/([^/]+)\/withdraw$/, handlers: { POST: testimonialWithdraw } },
  { pattern: /^\/api\/blocklist$/, handlers: { POST: blocklistAdd } },
  { pattern: /^\/api\/counts$/, handlers: { GET: countsRead } },
];

/** @param {unknown} error */
function errorResponse(error, env) {
  const message = error instanceof Error ? error.message : "";
  const status = Object.hasOwn(CLIENT_ERRORS, message)
    ? CLIENT_ERRORS[/** @type {keyof typeof CLIENT_ERRORS} */ (message)]
    : /^github-\d+$/.test(message)
      ? 502
      : null;
  if (status === null) {
    log(env, "error", "admin.unhandled", { errorName: error instanceof Error ? error.name : "Error" });
    return json({ error: "internal" }, 500);
  }
  return json({ error: message }, status);
}

/**
 * @param {Request} request
 * @param {Env} env
 * @param {Context} _ctx
 * @param {Identity} identity
 * @returns {Promise<Response>}
 */
export async function routeAdmin(request, env, _ctx, identity) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname.startsWith("/v1/")) return notFound();
  if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

  for (const { pattern, handlers } of ROUTES) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    const handler = Object.hasOwn(handlers, request.method) ? handlers[request.method] : undefined;
    if (!handler) {
      return json({ error: "method-not-allowed" }, 405, { Allow: Object.keys(handlers).join(", ") });
    }
    let params;
    try {
      params = match.slice(1).map(decodeURIComponent);
    } catch {
      return notFound();
    }
    try {
      return await handler({ request, env, actor: identity.email, params, url });
    } catch (error) {
      return errorResponse(error, env);
    }
  }
  return notFound();
}
