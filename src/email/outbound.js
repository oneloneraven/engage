import { recordAudit } from "../audit.js";
import { newId } from "../lib/ids.js";
import { log } from "../lib/log.js";
import { namedSecret } from "../lib/secrets.js";
import { makeReplyAddress } from "./reply-address.js";

/**
 * @typedef {{
 *   DB: import("../lib/db.js").Database,
 *   EMAIL: { send: (message: object) => Promise<{ messageId?: string } | undefined> },
 *   REPLY_ADDRESS_SECRET?: string,
 *   APP_ENV?: string,
 *   RELEASE_VERSION?: string,
 * }} OutboundEnv
 */

/** @type {Record<string, string>} */
const KIND_NOUN = { issue: "report", feedback: "feedback", email: "message" };

/**
 * @param {OutboundEnv} env
 * @param {string} itemId
 * @param {string} productName
 * @param {string | null} subject
 * @returns {Promise<string>}
 */
async function replySubject(env, itemId, productName, subject) {
  if (subject) return `Re: ${subject}`;
  const row = await env.DB.prepare("SELECT kind FROM items WHERE id = ?").bind(itemId).first();
  const noun = KIND_NOUN[String(row?.kind)] ?? "message";
  return `Re: Your ${noun} about ${productName}`;
}

/** @param {unknown} error */
function errorCode(error) {
  const code = /** @type {{ code?: unknown }} */ (error)?.code;
  return typeof code === "string" && /^E_[A-Z_]{1,60}$/.test(code) ? code : "unknown";
}

/**
 * Sends a reply from the product's own address and stores it on the item's thread.
 * @param {OutboundEnv} env
 * @param {{ id: string, product: string, contactEmail: string | null, subject: string | null }} item
 * @param {import("../registry.js").Product} product
 * @param {string} text
 * @param {string} actor
 * @returns {Promise<{ messageId: string }>}
 */
export async function sendReply(env, item, product, text, actor) {
  if (!item.contactEmail) throw new Error("no-contact");
  const secret = namedSecret(env, "REPLY_ADDRESS_SECRET");
  if (!secret) throw new Error("reply-secret-missing");

  const inbound = await env.DB.prepare(
    "SELECT rfc_message_id FROM messages WHERE item_id = ? AND direction = 'in' AND rfc_message_id IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1",
  )
    .bind(item.id)
    .first();
  const inReplyTo = /** @type {string | undefined} */ (inbound?.rfc_message_id ?? undefined);
  const fromAddress = `hello@${product.emailDomain}`;

  /** @type {{ messageId?: string } | undefined} */
  let result;
  try {
    result = await env.EMAIL.send({
      from: { email: fromAddress, name: product.name },
      to: item.contactEmail,
      subject: await replySubject(env, item.id, product.name, item.subject),
      text,
      replyTo: await makeReplyAddress(item.id, product.emailDomain, secret),
      ...(inReplyTo && { headers: { "In-Reply-To": inReplyTo, References: inReplyTo } }),
    });
  } catch (error) {
    log(env, "error", "reply.send-failed", { errorName: errorCode(error) });
    throw new Error("send-failed");
  }

  const messageId = newId();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO messages (id, item_id, direction, from_addr, body_text, rfc_message_id, created_at) VALUES (?, ?, 'out', ?, ?, ?, ?)",
    ).bind(messageId, item.id, fromAddress, text, result?.messageId ?? null, now),
    env.DB.prepare("UPDATE items SET last_activity_at = ?, reply_owed_at = NULL WHERE id = ?").bind(now, item.id),
  ]);
  await recordAudit(env, {
    actor,
    action: "reply.sent",
    targetType: "item",
    targetId: item.id,
    detail: { messageId },
  });
  return { messageId };
}
