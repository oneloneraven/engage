/** @typedef {{ CL_USAGE_CLIENT_ID?: string, CL_USAGE_CLIENT_SECRET?: string }} ClUsageEnv */

/** @param {ClUsageEnv} env */
export const ready = env => Boolean(env.CL_USAGE_CLIENT_ID && env.CL_USAGE_CLIENT_SECRET);

/** The endpoint only knows the present. */
export const canLookBack = false;

/**
 * One figure from a product's usage endpoint, read through its Access service token.
 * @param {ClUsageEnv} env
 * @param {{ url?: unknown, field?: unknown }} config
 * @returns {Promise<unknown>}
 */
export async function read(env, config) {
  if (typeof config.url !== "string" || !config.url.startsWith("https://") || typeof config.field !== "string")
    throw new Error("bad-config");
  const response = await fetch(config.url, {
    headers: {
      "CF-Access-Client-Id": String(env.CL_USAGE_CLIENT_ID),
      "CF-Access-Client-Secret": String(env.CL_USAGE_CLIENT_SECRET),
    },
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`usage-${response.status}`);
  const body = /** @type {Record<string, unknown>} */ (await response.json());
  return body[config.field];
}
