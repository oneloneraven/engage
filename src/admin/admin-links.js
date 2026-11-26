const PLACEHOLDER = "{value}";
const LABEL_MAX = 40;

/** @param {unknown} raw @returns {any[]} */
function arrayOf(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} hostname
 * @param {string[]} domains
 */
const onDomain = (hostname, domains) => domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));

/** @param {unknown} raw @returns {string | null} */
function labelOf(raw) {
  const label = typeof raw === "string" ? raw.trim() : "";
  return label && label.length <= LABEL_MAX ? label : null;
}

/**
 * The links from an item to its product's own admin: each template whose field the item's context holds, filled with
 * that value URL-encoded, with the template's label for what it opens. A template that isn't https, doesn't hold
 * exactly one {value}, or points off the product's domains gives no link.
 * @param {unknown} rawLinks the product's `admin_links`
 * @param {unknown} rawDomains the product's `domains`
 * @param {Record<string, unknown> | null} context
 * @returns {{ field: string, url: string, label: string | null }[]}
 */
export function adminLinks(rawLinks, rawDomains, context) {
  if (!context) return [];
  const domains = arrayOf(rawDomains).map(String);
  return arrayOf(rawLinks).flatMap(link => {
    const field = typeof link?.field === "string" ? link.field : null;
    const template = typeof link?.url === "string" ? link.url : null;
    const value = field && Object.hasOwn(context, field) ? context[field] : null;
    if (!template || typeof value !== "string" || !value.trim()) return [];
    if (template.split(PLACEHOLDER).length !== 2) return [];
    let url;
    try {
      url = new URL(template.replace(PLACEHOLDER, encodeURIComponent(value.trim())));
    } catch {
      return [];
    }
    if (url.protocol !== "https:" || url.username || url.password || !onDomain(url.hostname, domains)) return [];
    return [{ field: /** @type {string} */ (field), url: url.href, label: labelOf(link.label) }];
  });
}
