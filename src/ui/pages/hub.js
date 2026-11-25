import { getCounts, getItem, getRelease } from "../api.js";
import { failure, h, loading, replace } from "../dom.js";
import { healthWord } from "../format.js";
import { navigate } from "../router.js";
import { loadHub, productCard } from "./home.js";
import { inboxPage } from "./inbox.js";
import { junkPage } from "./junk.js";
import { releasesPage } from "./releases.js";
import { healthPage, usagePage } from "./signals.js";

/** The pages every product has, in tab order. A product's own pages come after these (#131). */
const PAGES = [
  { id: "", title: "Overview" },
  { id: "inbox", title: "Inbox" },
  { id: "releases", title: "Releases" },
  { id: "health", title: "Health" },
  { id: "usage", title: "Usage" },
];

/**
 * @typedef {import("../api.js").ProductCounts & { slug: string, route: string }} HubProduct
 */

/**
 * The page for a route nobody has, inside the frame.
 * @param {HTMLElement} container
 */
function notFound(container) {
  document.title = "Not found – Engage";
  replace(
    container,
    h("h1", { class: "page-title" }, "Not found"),
    h("p", { class: "empty" }, "That page doesn't exist. ", h("a", { href: "/", "data-link": "" }, "Go to Home"), "."),
  );
}

/**
 * A product's hub at `/<route>` and `/<route>/<page>[/<item id>]`: its name, its tabs, and the page underneath.
 * @param {HTMLElement} container
 * @param {import("../router.js").RouteContext} context
 * @returns {import("../router.js").Page}
 */
export function hubPage(container, context) {
  const root = h("div", { class: "page hub" }, loading());
  container.append(root);
  let alive = true;
  let current = context;
  /** @type {{ key: string, page: import("../router.js").Page } | null} */
  let inner = null;
  /** @type {Awaited<ReturnType<typeof loadHub>> | null} */
  let hub = null;

  /** @param {import("../router.js").RouteContext} next */
  const keyOf = next => `${next.params[0]}/${next.params[1] ?? ""}/${next.query.get("state") === "junk"}`;

  function draw() {
    if (!hub) return;
    const [route, pageId = ""] = current.params;
    const entry = hub.products.find(({ slug, product }) => (product.route ?? slug) === route);
    const page = PAGES.find(candidate => candidate.id === pageId);
    if (!entry || !page) {
      inner?.page.destroy();
      inner = null;
      notFound(root);
      return;
    }
    /** @type {HubProduct} */
    const product = { ...entry.product, slug: entry.slug, route };
    const href = (/** @type {string} */ id) => `/${route}${id ? `/${id}` : ""}`;
    const body = h("div", { class: "hub-body", "data-colour": product.colour ?? "" });
    const menu = h("details", { class: "hub-menu" }, h("summary", null, page.title));
    menu.append(
      h(
        "ul",
        null,
        PAGES.map(candidate =>
          h(
            "li",
            null,
            h(
              "a",
              {
                href: href(candidate.id),
                "data-link": "",
                ...(candidate === page && { "aria-current": "page" }),
              },
              candidate.title,
            ),
          ),
        ),
      ),
    );
    menu.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest("a")) menu.open = false;
    });
    inner?.page.destroy();
    replace(
      root,
      h(
        "div",
        { class: "hub-head", "data-colour": product.colour ?? "" },
        h("h1", { class: "hub-title" }, h("span", { class: "swatch", "aria-hidden": "true" }), product.name),
        product.signals &&
          h(
            "span",
            { class: "health-pill", "data-health": product.signals.health.status },
            h("span", { class: "dot", "aria-hidden": "true" }),
            healthWord(product.signals.health.status),
          ),
      ),
      h(
        "nav",
        { class: "hub-tabs", "aria-label": `${product.name} pages`, "data-colour": product.colour ?? "" },
        h(
          "ul",
          null,
          PAGES.map(candidate =>
            h(
              "li",
              null,
              h(
                "a",
                {
                  href: href(candidate.id),
                  "data-link": "",
                  ...(candidate === page && { "aria-current": "page" }),
                },
                candidate.title,
              ),
            ),
          ),
        ),
      ),
      menu,
      body,
    );
    const base = href(page.id);
    const subContext = { ...current, params: current.params.slice(2) };
    const named = { slug: product.slug, name: product.name, route };
    if (page.id === "") {
      document.title = `${product.name} – Engage`;
      body.append(
        h(
          "ul",
          { class: "hub-cards" },
          productCard(entry.slug, entry.product, entry.needs, () => refresh()),
        ),
      );
      inner = null;
    } else if (page.id === "releases") {
      inner = { key: keyOf(current), page: releasesPage(body, subContext, { product: named, base }) };
    } else if (page.id === "health") {
      inner = { key: keyOf(current), page: healthPage(body, { product: named }) };
    } else if (page.id === "usage") {
      inner = { key: keyOf(current), page: usagePage(body, { product: named }) };
    } else if (current.query.get("state") === "junk") {
      inner = { key: keyOf(current), page: junkPage(body, { product, base }) };
    } else {
      inner = {
        key: keyOf(current),
        page: inboxPage(body, subContext, {
          product: { slug: product.slug, name: product.name, colour: product.colour ?? "", new: product.new },
          base,
        }),
      };
    }
  }

  function refresh() {
    loadHub()
      .then(loaded => {
        if (!alive) return;
        hub = loaded;
        draw();
      })
      .catch(error => {
        if (alive) replace(root, failure(error.message));
      });
  }
  refresh();

  return {
    update(next) {
      const sameView = inner && keyOf(next) === inner.key;
      current = next;
      if (sameView && inner) inner.page.update({ ...next, params: next.params.slice(2) });
      else draw();
    },
    destroy() {
      alive = false;
      inner?.page.destroy();
    },
  };
}

/**
 * `/items/<id>` from Discord pings and older links: sends you to the item in its product's inbox.
 * @param {HTMLElement} container
 * @param {import("../router.js").RouteContext} context
 * @returns {import("../router.js").Page}
 */
export function itemRedirectPage(container, context) {
  container.append(loading("Opening the item…"));
  let alive = true;
  const [id] = context.params;
  Promise.all([getItem(id), getCounts()])
    .then(([item, counts]) => {
      if (!alive) return;
      const route = counts.byProduct[item.product]?.route ?? item.product;
      const reply = context.query.has("reply") ? "?reply" : "";
      navigate(`/${encodeURIComponent(route)}/inbox/${encodeURIComponent(id)}${reply}`, { replace: true });
    })
    .catch(error => {
      if (alive) replace(container, failure(error.message));
    });
  return {
    update() {},
    destroy() {
      alive = false;
    },
  };
}

/**
 * The old `/inbox`: a product's filters go to that product's inbox, and anything else to search.
 * @param {HTMLElement} container
 * @param {import("../router.js").RouteContext} context
 * @returns {import("../router.js").Page}
 */
export function inboxRedirectPage(container, context) {
  container.append(loading());
  let alive = true;
  const query = new URLSearchParams(context.query);
  const slug = query.get("product");
  query.delete("product");
  query.delete("search");
  getCounts()
    .then(counts => {
      if (!alive) return;
      const route = slug ? (counts.byProduct[slug]?.route ?? null) : null;
      const rest = query.size ? `?${query}` : "";
      navigate(route ? `/${encodeURIComponent(route)}/inbox${rest}` : `/search${rest}`, { replace: true });
    })
    .catch(error => {
      if (alive) replace(container, failure(error.message));
    });
  return {
    update() {},
    destroy() {
      alive = false;
    },
  };
}

/**
 * `/releases/<id>` from Discord pings and older links: sends you to the release in its product's hub.
 * @param {HTMLElement} container
 * @param {import("../router.js").RouteContext} context
 * @returns {import("../router.js").Page}
 */
export function releaseRedirectPage(container, context) {
  container.append(loading("Opening the release…"));
  let alive = true;
  const [id] = context.params;
  Promise.all([getRelease(id), getCounts()])
    .then(([{ release }, counts]) => {
      if (!alive) return;
      const route = counts.byProduct[release.product]?.route ?? release.product;
      navigate(`/${encodeURIComponent(route)}/releases/${encodeURIComponent(id)}`, { replace: true });
    })
    .catch(error => {
      if (alive) replace(container, failure(error.message));
    });
  return {
    update() {},
    destroy() {
      alive = false;
    },
  };
}

/**
 * The old `/releases`: releases live in each product's hub now, and Home shows every one waiting.
 * @returns {import("../router.js").Page}
 */
export function releasesRedirectPage() {
  queueMicrotask(() => navigate("/", { replace: true }));
  return { update() {}, destroy() {} };
}
