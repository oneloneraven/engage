import { climbsPage } from "./climbing-logbook/climbs.js";

/**
 * Each product's own hub pages, by route, after the foundation pages. Add a product's page here.
 * @type {Record<string, import("./pages.js").ProductPage[]>}
 */
export const PRODUCT_PAGES = {
  "climbing-logbook": [{ path: "climbs", title: "Climbs", mount: climbsPage }],
};
