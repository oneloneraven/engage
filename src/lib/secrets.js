/**
 * A Worker secret whose name a registry row holds.
 * @param {object} env
 * @param {string} name
 * @returns {string | undefined}
 */
export function namedSecret(env, name) {
  const value = /** @type {Record<string, unknown>} */ (env)[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}
