const encoder = new TextEncoder();

/**
 * HMAC-SHA256 of `data` under `secret`, as lowercase hex.
 * @param {string} secret
 * @param {string} data
 * @returns {Promise<string>}
 */
export async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Compares two strings without returning early on the first difference.
 * @param {string} a
 * @param {string} b
 */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
