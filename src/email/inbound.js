import PostalMime from "postal-mime";
import { notifyNew } from "../discord.js";
import { newId } from "../lib/ids.js";
import { log } from "../lib/log.js";
import { namedSecret } from "../lib/secrets.js";
import { productForEmailDomain } from "../registry.js";
import { htmlToText } from "./html-text.js";
import { parseReplyAddress } from "./reply-address.js";

/**
 * @typedef {{
 *   from: string,
 *   to: string,
 *   headers: Headers,
 *   raw: ReadableStream<Uint8Array>,
 *   rawSize: number,
 *   setReject: (reason: string) => void,
 *   forward: (address: string) => Promise<unknown>,
 * }} InboundMessage
 */

/**
 * @typedef {{
 *   DB: import("../lib/db.js").Database,
 *   ATTACHMENTS: {
 *     put: (key: string, value: ArrayBuffer | Uint8Array, options: { httpMetadata: { contentType: string } }) => Promise<unknown>,
 *     delete: (keys: string[]) => Promise<unknown>,
 *   },
 *   REPLY_ADDRESS_SECRET?: string,
 *   ADMIN_HOST?: string,
 *   APP_ENV?: string,
 *   RELEASE_VERSION?: string,
 * }} InboundEnv
 */

/** @typedef {"pass" | "fail" | "none"} AuthVerdict */
/** @typedef {{ spf: AuthVerdict, dkim: AuthVerdict, dmarc: AuthVerdict }} AuthResult */

const REJECTION = "Address does not exist";
const MAX_SUBJECT_CHARACTERS = 200;
const MAX_TEXT_BYTES = 500_000;
const MAX_HTML_BYTES = 1_000_000;
const TRUNCATION_NOTE = "\n\n[This message was too long to show in full. The whole text is attached as message.txt.]";
const RESULT = /(?<![\w.-])(spf|dkim|dmarc)\s*=\s*([a-z]+)/gi;
const SENDER = /^[^@\s]+@[^@\s]+$/;

/** @param {unknown} error */
const errorName = error => (error instanceof Error ? error.name : "unknown");

/**
 * @param {string} mechanism
 * @param {string} value
 * @returns {AuthVerdict}
 */
function verdict(mechanism, value) {
  const result = value.toLowerCase();
  if (result === "pass") return "pass";
  if (result === "fail" || (mechanism === "spf" && result === "softfail")) return "fail";
  return "none";
}

/**
 * SPF, DKIM and DMARC verdicts from Authentication-Results. Where a header says more than once, a failure wins.
 * @param {string | null} header
 * @returns {AuthResult}
 */
export function parseAuthResults(header) {
  /** @type {AuthResult} */
  const results = { spf: "none", dkim: "none", dmarc: "none" };
  for (const [, name, value] of (header ?? "").matchAll(RESULT)) {
    const mechanism = /** @type {keyof AuthResult} */ (name.toLowerCase());
    const next = verdict(mechanism, value);
    if (next === "fail" || (next === "pass" && results[mechanism] === "none")) results[mechanism] = next;
  }
  return results;
}

/**
 * @param {InboundEnv} env
 * @param {InboundMessage} message
 * @returns {Promise<{ product: import("../registry.js").Product, itemId: string | null } | null>}
 */
async function route(env, message) {
  const recipient = message.to.trim().toLowerCase();
  const at = recipient.lastIndexOf("@");
  if (at < 1) return null;
  const product = await productForEmailDomain(env, recipient.slice(at + 1));
  if (!product) return null;
  const local = recipient.slice(0, at);

  if (local.startsWith("reply+")) {
    const secret = namedSecret(env, "REPLY_ADDRESS_SECRET");
    if (!secret) {
      log(env, "error", "email.reply-secret-missing", { product: product.slug });
      return null;
    }
    const itemId = await parseReplyAddress(recipient, secret);
    if (!itemId) return null;
    const item = await env.DB.prepare("SELECT 1 AS found FROM items WHERE id = ? AND product = ?")
      .bind(itemId, product.slug)
      .first();
    return item ? { product, itemId } : null;
  }

  const accepted = local === "hello" || product.emailAliases.some(alias => alias.toLowerCase() === local);
  return accepted ? { product, itemId: null } : null;
}

/**
 * @param {InboundEnv} env
 * @param {InboundMessage} message
 * @returns {Promise<import("postal-mime").Email | null>}
 */
async function parse(env, message) {
  try {
    return await PostalMime.parse(message.raw);
  } catch (error) {
    log(env, "error", "email.parse-failed", { errorName: errorName(error) });
    return null;
  }
}

/** @param {import("postal-mime").Email | null} email */
function senderOf(email) {
  const address = email?.from?.address?.trim().toLowerCase();
  return address && SENDER.test(address) ? { address, name: email?.from?.name || null } : null;
}

/**
 * @param {InboundEnv} env
 * @param {string} address
 */
async function isBlocked(env, address) {
  const row = await env.DB.prepare("SELECT 1 AS blocked FROM blocklist WHERE lower(pattern) IN (?, ?)")
    .bind(address, address.slice(address.lastIndexOf("@")))
    .first();
  return Boolean(row);
}

/** @param {import("postal-mime").Attachment["content"]} content */
const bytesOf = content => (typeof content === "string" ? new TextEncoder().encode(content) : content);

/**
 * The longest start of `value` that fits in `maxBytes` of UTF-8, never splitting a character.
 * @param {string} value
 * @param {number} maxBytes
 */
function utf8Prefix(value, maxBytes) {
  const { read } = new TextEncoder().encodeInto(value, new Uint8Array(maxBytes));
  return value.slice(0, read);
}

/**
 * D1 rows hold at most 2,000,000 bytes, so a body bigger than its share is kept whole in R2 as an attachment instead.
 * @param {string} text
 * @param {string | null} html
 */
function fitBodies(text, html) {
  const encoder = new TextEncoder();
  /** @type {{ content: Uint8Array, filename: string, contentType: string }[]} */
  const overflow = [];
  let storedText = text;
  let storedHtml = html;
  const textBytes = encoder.encode(text);
  if (textBytes.byteLength > MAX_TEXT_BYTES) {
    overflow.push({ content: textBytes, filename: "message.txt", contentType: "text/plain" });
    storedText = `${utf8Prefix(text, MAX_TEXT_BYTES - encoder.encode(TRUNCATION_NOTE).byteLength)}${TRUNCATION_NOTE}`;
  }
  const htmlBytes = html === null ? null : encoder.encode(html);
  if (htmlBytes && htmlBytes.byteLength > MAX_HTML_BYTES) {
    overflow.push({ content: htmlBytes, filename: "message.html", contentType: "text/html" });
    storedHtml = null;
  }
  return { text: storedText, html: storedHtml, overflow };
}

/**
 * Takes one inbound message: a new email item, or a reply appended to the item its address belongs to.
 * @param {InboundMessage} message
 * @param {InboundEnv} env
 * @param {{ waitUntil: (promise: Promise<unknown>) => void }} ctx
 * @returns {Promise<void>}
 */
export async function handleInboundEmail(message, env, ctx) {
  const target = await route(env, message);
  if (!target) {
    message.setReject(REJECTION);
    return;
  }
  const { product, itemId: replyItemId } = target;

  if (product.backupForwardTo) {
    try {
      await message.forward(product.backupForwardTo);
    } catch (error) {
      log(env, "warn", "email.forward-failed", { product: product.slug, errorName: errorName(error) });
    }
  }

  const email = await parse(env, message);
  const sender = senderOf(email);
  const auth = parseAuthResults(message.headers.get("authentication-results"));
  const suspect = !sender || auth.dmarc === "fail" || (await isBlocked(env, sender.address));

  const itemId = replyItemId ?? newId();
  const messageId = newId();
  const now = new Date().toISOString();
  const fullHtml = email?.html || null;
  const fullText = email?.text?.trim() ? email.text : fullHtml ? htmlToText(fullHtml) : "";
  const { text, html, overflow } = fitBodies(fullText, fullHtml);
  const subject = [...(email?.subject?.trim() ?? "")].slice(0, MAX_SUBJECT_CHARACTERS).join("") || null;

  const attachments = [
    ...(email?.attachments ?? []).map(attachment => ({
      content: bytesOf(attachment.content),
      filename: attachment.filename,
      contentType: attachment.mimeType,
    })),
    ...overflow,
  ].map(attachment => ({ id: newId(), ...attachment }));
  const keys = attachments.map(attachment => `items/${itemId}/${attachment.id}`);
  await Promise.all(
    attachments.map((attachment, index) =>
      env.ATTACHMENTS.put(keys[index], attachment.content, { httpMetadata: { contentType: attachment.contentType } }),
    ),
  );

  const db = env.DB;
  const itemStatement = replyItemId
    ? db
        .prepare(`UPDATE items SET last_activity_at = ?${suspect ? "" : ", read_at = NULL"} WHERE id = ?`)
        .bind(now, itemId)
    : db
        .prepare(
          "INSERT INTO items (id, product, kind, source, subject, contact_email, contact_name, auth_result, junk, created_at, last_activity_at) VALUES (?, ?, 'email', 'email', ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          itemId,
          product.slug,
          subject,
          sender?.address ?? null,
          sender?.name ?? null,
          JSON.stringify(auth),
          suspect ? 1 : 0,
          now,
          now,
        );
  const statements = [
    itemStatement,
    db
      .prepare(
        "INSERT INTO messages (id, item_id, direction, from_addr, body_text, body_html, rfc_message_id, created_at) VALUES (?, ?, 'in', ?, ?, ?, ?, ?)",
      )
      .bind(messageId, itemId, sender?.address ?? null, text, html, email?.messageId ?? null, now),
    ...attachments.map((attachment, index) =>
      db
        .prepare(
          "INSERT INTO attachments (id, item_id, message_id, r2_key, filename, content_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          attachment.id,
          itemId,
          messageId,
          keys[index],
          attachment.filename,
          attachment.contentType,
          attachment.content.byteLength,
        ),
    ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (keys.length > 0) await env.ATTACHMENTS.delete(keys);
    throw error;
  }

  if (!suspect) ctx.waitUntil(notifyNew(env, product, { kind: replyItemId ? "reply" : "email", itemId }));
}
