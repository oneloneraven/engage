/** @typedef {{ limit: (options: { key: string }) => Promise<{ success: boolean }> }} RateLimiter */

/** @param {Request} request */
export const clientIp = request => request.headers.get("CF-Connecting-IP") ?? "unknown";

/**
 * @param {RateLimiter | undefined} limiter
 * @param {string} key
 * @returns {Promise<boolean>} true when the caller is over the limit; a missing limiter limits everyone.
 */
export async function isLimited(limiter, key) {
  if (!limiter) return true;
  return !(await limiter.limit({ key })).success;
}
