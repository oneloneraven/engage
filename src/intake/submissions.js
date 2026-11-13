import { notifyNew } from "../discord.js";
import { json } from "../lib/http.js";
import { clientIp, isLimited } from "../lib/rate-limit.js";
import { newId } from "../lib/ids.js";
import { getProduct, productForOrigin } from "../registry.js";
import * as v from "valibot";
import { submissionSchema, validateContext } from "./schema.js";
import { verifyTurnstile } from "./turnstile.js";

const BODY_LIMIT_BYTES = 128 * 1024;
const PREFLIGHT_MAX_AGE_S = 86400;
const TRUTHY = ["on", "true", "1"];

/** @param {import("../registry.js").Product} product */
const thanks = product =>
  new Response(null, { status: 303, headers: { Location: product.thanksUrl, "Cache-Control": "no-store" } });

/** @param {string} error @param {string[]} [fields] */
const invalid = (error, fields) => json(fields ? { error, fields } : { error }, 400);

/**
 * @param {string} contentType
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
function parseFields(contentType, text) {
  if (contentType.startsWith("application/json")) {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  const fields = Object.fromEntries(new URLSearchParams(text));
  const { "cf-turnstile-response": turnstileToken, quoteConsent, ...rest } = fields;
  return {
    ...rest,
    turnstileToken,
    quoteConsent: quoteConsent === undefined ? undefined : TRUTHY.includes(quoteConsent),
  };
}

/** @param {Record<string, unknown>} fields */
const withoutBlanks = fields => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ""));

/** @param {string} contentType */
const isSupported = contentType =>
  contentType.startsWith("application/json") || contentType.startsWith("application/x-www-form-urlencoded");

/**
 * @param {Request} request
 * @param {import("../worker.js").Env} env
 * @param {{ waitUntil: (promise: Promise<unknown>) => void }} ctx
 * @returns {Promise<Response>}
 */
async function receive(request, env, ctx) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!isSupported(contentType)) return json({ error: "unsupported-media-type" }, 415);
  if (Number(request.headers.get("Content-Length") ?? 0) > BODY_LIMIT_BYTES) return json({ error: "too-large" }, 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > BODY_LIMIT_BYTES) return json({ error: "too-large" }, 413);
  const text = new TextDecoder().decode(bytes);

  const fields = parseFields(contentType, text);
  if (!fields) return invalid("invalid-body");
  const parsed = v.safeParse(submissionSchema, withoutBlanks(fields));
  if (!parsed.success) {
    const paths = parsed.issues.map(issue => v.getDotPath(issue) ?? "body");
    return invalid("invalid-submission", [...new Set(paths)]);
  }
  const submission = parsed.output;
  const isForm = !contentType.startsWith("application/json");
  const ip = clientIp(request);

  const limiter = submission.source === "web" ? env.INTAKE_WEB_LIMITER : env.INTAKE_APP_LIMITER;
  if (await isLimited(limiter, `${submission.source}:${ip}`)) return json({ error: "rate-limited" }, 429);

  const product = await getProduct(env, submission.product);
  if (!product) return invalid("invalid-submission", ["product"]);

  const id = newId();
  if (submission.hpx) {
    return isForm ? thanks(product) : json({ id }, 201);
  }
  if (submission.source === "web" && !(await verifyTurnstile(submission.turnstileToken ?? "", ip, env))) {
    return invalid("verification-failed");
  }

  const context = validateContext(product.contextSchema, submission.context);
  if (!context.ok) return invalid("invalid-submission", ["context"]);

  const now = new Date().toISOString();
  let suspectedSpam = 0;
  if (submission.source === "app") {
    const startOfDay = `${now.slice(0, 10)}T00:00:00.000Z`;
    const today = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM items WHERE product = ? AND source = 'app' AND created_at >= ?",
    )
      .bind(product.slug, startOfDay)
      .first();
    suspectedSpam = Number(today?.n) >= product.appDailyCap ? 1 : 0;
  }

  const feedback = submission.kind === "feedback";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO items (id, product, kind, source, contact_email, contact_name, quote_consent, credit,
        source_page, section, app_version, context, account_ref, suspected_spam, created_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      product.slug,
      submission.kind,
      submission.source,
      submission.contactEmail ?? null,
      submission.contactName || null,
      feedback && submission.quoteConsent ? 1 : 0,
      feedback ? (submission.credit ?? null) : null,
      submission.sourcePage ?? null,
      submission.section || null,
      submission.appVersion ?? null,
      Object.keys(context.value).length > 0 ? JSON.stringify(context.value) : null,
      submission.accountRef || null,
      suspectedSpam,
      now,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO messages (id, item_id, direction, body_text, created_at) VALUES (?, ?, 'in', ?, ?)",
    ).bind(newId(), id, submission.message, now),
  ]);

  if (!suspectedSpam) ctx.waitUntil(notifyNew(env, product, { kind: submission.kind, itemId: id }));
  return isForm ? thanks(product) : json({ id }, 201);
}

/**
 * @param {Request} request
 * @param {import("../worker.js").Env} env
 * @param {{ waitUntil: (promise: Promise<unknown>) => void }} ctx
 * @returns {Promise<Response>}
 */
export async function handleSubmission(request, env, ctx) {
  const origin = request.headers.get("Origin");
  const allowed = origin ? await productForOrigin(env, origin) : null;
  /** @type {Record<string, string>} */
  const cors = { Vary: "Origin" };
  if (origin && allowed) cors["Access-Control-Allow-Origin"] = origin;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_S),
        "Cache-Control": "no-store",
      },
    });
  }

  const result = await receive(request, env, ctx);
  const response = new Response(result.body, result);
  for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  return response;
}
