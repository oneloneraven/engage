import { getCounts } from "./api.js";
import { h, icon, replace } from "./dom.js";

const SEARCH_ICON = ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "m20 20-3.5-3.5"];

/** @type {{ slug: string, route: string, name: string, colour: string }[]} */
let products = [];

/**
 * Builds the page frame, a full-width top bar over the page, and returns the element the router renders
 * into.
 * @returns {{ main: HTMLElement, highlight: (path: string) => void }}
 */
export function mountShell() {
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  const switcher = h("div", { class: "switcher-slot" });
  const main = h("main", { id: "main", tabindex: "-1" });
  app.append(
    h("a", { class: "skip", href: "#main" }, "Skip to content"),
    h(
      "div",
      { class: "frame" },
      h(
        "header",
        { class: "bar" },
        h("a", { class: "brand", href: "/", "data-link": "" }, "Engage"),
        switcher,
        h(
          "a",
          { class: "button search-link", href: "/search", "data-link": "", "aria-label": "Search messages" },
          icon(...SEARCH_ICON),
          h("span", { class: "search-label" }, "Search messages"),
        ),
      ),
      main,
    ),
  );
  let lastPath = "/";
  getCounts()
    .then(counts => {
      products = Object.entries(counts.byProduct).map(([slug, product]) => ({
        slug,
        route: product.route ?? slug,
        name: product.name,
        colour: product.colour ?? "",
      }));
      draw(lastPath);
    })
    .catch(() => {});

  /** @param {string} path */
  function draw(path) {
    lastPath = path;
    const route = path.split("/")[1] ?? "";
    const current = products.find(product => product.route === route);
    replace(
      switcher,
      current &&
        h(
          "details",
          { class: "switcher", "data-colour": current.colour },
          h(
            "summary",
            null,
            h("span", { class: "swatch", "aria-hidden": "true" }),
            current.name,
            h("span", { class: "visually-hidden" }, ", switch product"),
          ),
          h(
            "ul",
            null,
            products.map(product =>
              h(
                "li",
                { "data-colour": product.colour },
                h(
                  "a",
                  {
                    href: `/${encodeURIComponent(product.route)}`,
                    "data-link": "",
                    ...(product === current && { "aria-current": "page" }),
                    onclick: (/** @type {Event} */ event) => {
                      /** @type {HTMLDetailsElement | null} */ (
                        /** @type {Element} */ (event.currentTarget).closest("details")
                      )?.removeAttribute("open");
                    },
                  },
                  h("span", { class: "swatch", "aria-hidden": "true" }),
                  product.name,
                ),
              ),
            ),
          ),
        ),
    );
  }
  draw("/");
  return { main, highlight: path => draw(path) };
}
