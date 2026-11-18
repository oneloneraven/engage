import { hmacHex, timingSafeEqual } from "../lib/hmac.js";

const SIGNATURE_HEX = 16;
// Lowercase because some mail systems change the case of the local part; the id is signed in its canonical uppercase.
const REPLY_ADDRESS = /^reply\+([0-9a-z]{26})\.([0-9a-f]{16})@[^@\s]+$/;

/** @param {string} itemId @param {string} secret */
const signatureFor = async (itemId, secret) => (await hmacHex(secret, itemId)).slice(0, SIGNATURE_HEX);

/**
 * The address a reply to `itemId` should go to, so it threads back onto that item.
 * @param {string} itemId
 * @param {string} domain
 * @param {string} secret
 * @returns {Promise<string>}
 */
export async function makeReplyAddress(itemId, domain, secret) {
  return `reply+${itemId.toLowerCase()}.${await signatureFor(itemId.toUpperCase(), secret)}@${domain}`;
}

/**
 * The item id a reply address belongs to, or null when it's malformed or its signature doesn't match.
 * @param {string} address
 * @param {string} secret
 * @returns {Promise<string | null>}
 */
export async function parseReplyAddress(address, secret) {
  const match = REPLY_ADDRESS.exec(address.trim().toLowerCase());
  if (!match) return null;
  const itemId = match[1].toUpperCase();
  return timingSafeEqual(match[2], await signatureFor(itemId, secret)) ? itemId : null;
}
