import { getCounts } from "./api.js";
import { h, icon, replace } from "./dom.js";

const SEARCH_ICON = ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "m20 20-3.5-3.5"];

/** @type {HTMLElement | null} */
let nav = null;
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
 * Builds the page frame, a full-width top bar over the page, and returns the element the router renders
 * into.
 * @returns {{ main: HTMLElement, highlight: (path: string, query: URLSearchParams) => void }}
 */
export function mountShell() {
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  const menu = h(
    "button",
    { type: "button", class: "menu-toggle", "aria-expanded": "false", "aria-controls": "site-nav" },
    "Menu",
  );
  nav = h("nav", { id: "site-nav", class: "site-nav", "aria-label": "Main" });
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
        nav,
        h(
          "a",
          { class: "button search-link", href: "/inbox?search", "data-link": "", "aria-label": "Search messages" },
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
      newCount = counts.new;
      releasesWaiting = counts.releasesWaiting;
      draw(lastPath);
    })
    .catch(() => {});

  /** @param {string} path */
  function draw(path) {
    if (!nav) return;
    lastPath = path;
    replace(
      nav,
      h(
        "ul",
        { class: "nav-list" },
        h(
          "li",
          null,
          navLink(
            "/inbox",
            path === "/inbox" || path.startsWith("/items/"),
            "Inbox",
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
        h("li", null, navLink("/junk", path === "/junk", "Junk")),
      ),
    );
  }
  draw("/");
  return { main, highlight: path => draw(path) };
}
