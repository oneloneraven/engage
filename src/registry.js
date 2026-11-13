/**
 * @typedef {{
 *   slug: string,
 *   name: string,
 *   domains: string[],
 *   issueRepo: string,
 *   siteRepo: string | null,
 *   siteDispatchEvent: string | null,
 *   discordSecret: string,
 *   emailDomain: string,
 *   emailAliases: string[],
 *   retentionMonths: number,
 *   appDailyCap: number,
 *   contextSchema: Record<string, { maxLength: number }>,
 *   backupForwardTo: string | null,
 *   testimonialsEnabled: boolean,
 *   accountSecret: string,
 *   thanksUrl: string,
 * }} Product
 */

/** @typedef {{ DB: import("./lib/db.js").Database }} RegistryEnv */

/**
 * @param {Record<string, unknown>} row
 * @returns {Product}
 */
function toProduct(row) {
  return {
    slug: String(row.slug),
    name: String(row.name),
    domains: JSON.parse(String(row.domains)),
    issueRepo: String(row.issue_repo),
    siteRepo: /** @type {string | null} */ (row.site_repo),
    siteDispatchEvent: /** @type {string | null} */ (row.site_dispatch_event),
    discordSecret: String(row.discord_secret),
    emailDomain: String(row.email_domain),
    emailAliases: JSON.parse(String(row.email_aliases)),
    retentionMonths: Number(row.retention_months),
    appDailyCap: Number(row.app_daily_cap),
    contextSchema: JSON.parse(String(row.context_schema)),
    backupForwardTo: /** @type {string | null} */ (row.backup_forward_to),
    testimonialsEnabled: row.testimonials_enabled === 1,
    accountSecret: String(row.account_secret),
    thanksUrl: String(row.thanks_url),
  };
}

/**
 * @param {RegistryEnv} env
 * @param {string} slug
 * @returns {Promise<Product | null>}
 */
export async function getProduct(env, slug) {
  const row = await env.DB.prepare("SELECT * FROM products WHERE slug = ?").bind(slug).first();
  return row ? toProduct(row) : null;
}

/**
 * @param {RegistryEnv} env
 * @param {string} origin
 * @returns {Promise<Product | null>}
 */
export async function productForOrigin(env, origin) {
  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return null;
  }
  const { results } = await env.DB.prepare("SELECT * FROM products").all();
  const match = results.map(toProduct).find(product => product.domains.includes(hostname));
  return match ?? null;
}
