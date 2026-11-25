import { getCounts } from "./api.js";
import { h, replace } from "./dom.js";

/** @type {HTMLElement | null} */
let nav = null;
/** @type {{ slug: string, name: string, colour: string }[]} */
let products = [];
let newCount = 0;
let releasesWaiting = 0;

/**
 * @param {string} href
 * @param {boolean} current
 * @param {...import("./dom.js").Child} children
 */
function navLink(href, current, ...children) {
  return h("a", { href, "data-link": "", ...(current && { "aria-current": "page" }) }, ...children);
}

/**
 * Builds the page frame and returns the element the router renders into.
 * @returns {{ main: HTMLElement, highlight: (path: string, query: URLSearchParams) => void }}
 */
export function mountShell() {
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  const menu = h(
    "button",
    { type: "button", class: "menu-toggle", "aria-expanded": "false", "aria-controls": "rail" },
    "Menu",
  );
  nav = h("nav", { "aria-label": "Main" });
  const rail = h("div", { id: "rail", class: "rail" }, nav);
  const main = h("main", { id: "main", tabindex: "-1" });
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    rail.classList.toggle("open", open);
  });
  rail.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest("a")) {
      menu.setAttribute("aria-expanded", "false");
      rail.classList.remove("open");
    }
  });
  app.append(
    h("a", { class: "skip", href: "#main" }, "Skip to content"),
    h(
      "div",
      { class: "frame" },
      h("header", { class: "bar" }, h("span", { class: "brand" }, "Engage"), menu),
      rail,
      main,
    ),
  );
  let lastPath = "/";
  let lastQuery = new URLSearchParams();
  getCounts()
    .then(counts => {
      products = Object.entries(counts.byProduct).map(([slug, { name, colour }]) => ({
        slug,
        name,
        colour: colour ?? "",
      }));
      newCount = counts.new;
      releasesWaiting = counts.releasesWaiting;
      draw(lastPath, lastQuery);
    })
    .catch(() => {});

  /**
   * @param {string} path
   * @param {URLSearchParams} query
   */
  function draw(path, query) {
    if (!nav) return;
    lastPath = path;
    lastQuery = query;
    const inInbox = path === "/inbox" || path.startsWith("/items/");
    const product = query.get("product");
    replace(
      nav,
      h("span", { class: "brand rail-brand" }, "Engage"),
      h(
        "ul",
        { class: "nav-list" },
        h("li", null, navLink("/", path === "/", "Home")),
        h(
          "li",
          null,
          navLink(
            "/inbox",
            inInbox && !product,
            h("span", { class: "nav-label" }, "Inbox"),
            newCount > 0 &&
              h("span", { class: "badge" }, String(newCount), h("span", { class: "visually-hidden" }, " new")),
          ),
        ),
        h(
          "li",
          null,
          navLink(
            "/releases",
            path === "/releases" || path.startsWith("/releases/"),
            h("span", { class: "nav-label" }, "Releases"),
            releasesWaiting > 0 &&
              h(
                "span",
                { class: "badge attention" },
                String(releasesWaiting),
                h("span", { class: "visually-hidden" }, " waiting"),
              ),
          ),
        ),
        h("li", null, navLink("/junk", path === "/junk", "Junk")),
      ),
      products.length > 0 && h("h2", { class: "nav-heading" }, "Products"),
      products.length > 0 &&
        h(
          "ul",
          { class: "nav-list" },
          products.map(({ slug, name, colour }) =>
            h(
              "li",
              { "data-colour": colour },
              navLink(
                `/inbox?product=${encodeURIComponent(slug)}`,
                inInbox && product === slug,
                h("span", { class: "swatch", "aria-hidden": "true" }),
                name,
              ),
            ),
          ),
        ),
    );
  }
  draw("/", lastQuery);
  return { main, highlight: draw };
}
