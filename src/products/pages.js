import { readClimbs } from "./climbing-logbook.js";

/**
 * What each product's own hub pages read, by product slug and page path. Each reader returns aggregate figures only.
 * @type {Record<string, Record<string, (env: any) => Promise<unknown>>>}
 */
export const PRODUCT_DATA = {
  cl: { climbs: readClimbs },
};

/**
 * @param {string} slug
 * @param {string} path
 */
export const productReader = (slug, path) =>
  Object.hasOwn(PRODUCT_DATA, slug) && Object.hasOwn(PRODUCT_DATA[slug], path) ? PRODUCT_DATA[slug][path] : null;
