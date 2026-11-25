/**
 * @typedef {{ slug: string, name: string, route: string, colour: string }} PageProduct
 * @typedef {(container: HTMLElement, options: { product: PageProduct }) => import("../router.js").Page} PageMount
 * @typedef {{ path: string, title: string, mount: PageMount }} ProductPage
 * @typedef {{ id: string, title: string, mount?: PageMount }} HubPage
 */

/** The pages every product has, in tab order. */
export const FOUNDATION = [
  { id: "", title: "Overview" },
  { id: "inbox", title: "Inbox" },
  { id: "releases", title: "Releases" },
  { id: "health", title: "Health" },
  { id: "usage", title: "Usage" },
];

const PATH = /^[a-z0-9-]+$/;

/**
 * A product's tabs: the foundation pages, then its own. An own page whose path a foundation page or an earlier own page
 * already has is left out, so it can never take a foundation page's place.
 * @param {string} route
 * @param {Record<string, ProductPage[]>} registry
 * @returns {HubPage[]}
 */
export function pagesFor(route, registry) {
  /** @type {HubPage[]} */
  const pages = [...FOUNDATION];
  for (const { path, title, mount } of Object.hasOwn(registry, route) ? registry[route] : []) {
    if (PATH.test(path) && !pages.some(page => page.id === path)) pages.push({ id: path, title, mount });
  }
  return pages;
}
