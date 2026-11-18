const ALLOWED_FIELDS = ["status", "errorName", "product"];

/**
 * One JSON object per event. Only allowlisted fields get through, so content can't reach the logs.
 * @param {{ APP_ENV?: string, RELEASE_VERSION?: string }} env
 * @param {"info" | "warn" | "error"} level
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 */
export function log(env, level, event, fields = {}) {
  const allowed = Object.fromEntries(Object.entries(fields).filter(([key]) => ALLOWED_FIELDS.includes(key)));
  console[level](
    JSON.stringify({ event, environment: env.APP_ENV, release: env.RELEASE_VERSION ?? "unreleased", ...allowed }),
  );
}
