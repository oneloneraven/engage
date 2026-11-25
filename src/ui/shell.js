import { getCounts } from "./api.js";
import { h, icon, replace } from "./dom.js";

const SEARCH_ICON = ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "m20 20-3.5-3.5"];

/** @type {HTMLElement | null} */
let nav = null;
let releasesWaiting = 0;
/** @type {{ slug: string, route: string, name: string, colour: string }[]} */
let products = [];

/**
 * @param {string} href
 * @param {boolean} current
 * @param {...import("./dom.js").Child} children
 */
function navLink(href, current, ...children) {
  return h("a", { href, "data-link": "", ...(current && { "aria-current": "page" }) }, ...children);
}

/**
 * Builds the page frame, a full-width top bar over the page, and returns the element the router renders
 * into.
 * @returns {{ main: HTMLElement, highlight: (path: string) => void }}
 */
export function mountShell() {
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  const menu = h(
    "button",
    { type: "button", class: "menu-toggle", "aria-expanded": "false", "aria-controls": "site-nav" },
    "Menu",
  );
  nav = h("nav", { id: "site-nav", class: "site-nav", "aria-label": "Main" });
  const switcher = h("div", { class: "switcher-slot" });
  const main = h("main", { id: "main", tabindex: "-1" });
  const closeMenu = () => {
    menu.setAttribute("aria-expanded", "false");
    nav?.classList.remove("open");
  };
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    nav?.classList.toggle("open", open);
  });
  nav.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest("a")) closeMenu();
  });
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
        nav,
        h(
          "a",
          { class: "button search-link", href: "/search", "data-link": "", "aria-label": "Search messages" },
          icon(...SEARCH_ICON),
          h("span", { class: "search-label" }, "Search messages"),
        ),
        menu,
      ),
      main,
    ),
  );
  let lastPath = "/";
  getCounts()
    .then(counts => {
      releasesWaiting = counts.releasesWaiting;
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
    if (!nav) return;
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
    replace(
      nav,
      h(
        "ul",
        { class: "nav-list" },
        h(
          "li",
          null,
          navLink(
            "/releases",
            path === "/releases" || path.startsWith("/releases/"),
            "Releases",
            releasesWaiting > 0 &&
              h(
                "span",
                { class: "badge attention" },
                String(releasesWaiting),
                h("span", { class: "visually-hidden" }, " waiting"),
              ),
          ),
        ),
      ),
    );
  }
  draw("/");
  return { main, highlight: path => draw(path) };
}
