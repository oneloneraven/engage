import * as v from "valibot";
import { codePointLength, normaliseMessage } from "../lib/text.js";

export const MESSAGE_MAX = 5000;

/** @param {string} value */
function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** @param {number} max */
const text = max => v.optional(v.pipe(v.string(), v.trim(), v.maxLength(max)));

export const submissionSchema = v.object({
  product: v.pipe(v.string(), v.maxLength(64)),
  kind: v.picklist(["issue", "feedback"]),
  source: v.picklist(["web", "app"]),
  message: v.pipe(
    v.string(),
    v.transform(normaliseMessage),
    v.check(message => codePointLength(message) >= 1),
    v.check(message => codePointLength(message) <= MESSAGE_MAX),
  ),
  contactEmail: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(254), v.email())),
  contactName: text(100),
  quoteConsent: v.optional(v.boolean()),
  credit: v.optional(v.picklist(["name", "initials", "anonymous"])),
  sourcePage: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500), v.check(isHttpUrl))),
  section: text(64),
  appVersion: v.optional(v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+$/))),
  context: v.optional(v.record(v.string(), v.unknown())),
  accountRef: text(64),
  turnstileToken: v.optional(v.pipe(v.string(), v.maxLength(2048))),
  hpx: v.optional(v.string()),
});

/**
 * Keeps only the keys the product's schema names. Not ok when a kept value isn't a string within its maxLength.
 * @param {Record<string, { maxLength: number }>} schema
 * @param {Record<string, unknown> | undefined} context
 * @returns {{ ok: true, value: Record<string, string> } | { ok: false }}
 */
export function validateContext(schema, context) {
  /** @type {Record<string, string>} */
  const value = {};
  for (const [key, { maxLength }] of Object.entries(schema)) {
    const given = context?.[key];
    if (given === undefined) continue;
    if (typeof given !== "string" || codePointLength(given) > maxLength) return { ok: false };
    value[key] = given;
  }
  return { ok: true, value };
}
