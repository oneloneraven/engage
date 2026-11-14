import { getCounts } from "./api.js";
import { h, replace } from "./dom.js";
import { productName } from "./format.js";

/** @type {HTMLElement | null} */
let nav = null;
/** @type {string[]} */
let products = [];

/** @param {string} href @param {string} label @param {boolean} current */
function navLink(href, label, current) {
  return h("a", { href, "data-link": "", ...(current && { "aria-current": "page" }) }, label);
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
      products = Object.keys(counts.byProduct);
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
        h("li", null, navLink("/", "Home", path === "/")),
        h("li", null, navLink("/inbox", "Inbox", inInbox && !product)),
        h("li", null, navLink("/junk", "Junk", path === "/junk")),
      ),
      products.length > 0 && h("h2", { class: "nav-heading" }, "Products"),
      products.length > 0 &&
        h(
          "ul",
          { class: "nav-list" },
          products.map(slug =>
            h(
              "li",
              null,
              navLink(`/inbox?product=${encodeURIComponent(slug)}`, productName(slug), inInbox && product === slug),
            ),
          ),
        ),
    );
  }
  draw("/", lastQuery);
  return { main, highlight: draw };
}
