import { getCounts, listItems } from "../api.js";
import { emptyState, failure, h, replace } from "../dom.js";
import { formatDay, itemTitle } from "../format.js";
import { navigate } from "../router.js";

const SEARCH_DELAY_MS = 250;

/**
 * Search across every product's messages, at `/search?q=`. Each result opens in its product's inbox.
 * @param {HTMLElement} container
 * @param {import("../router.js").RouteContext} context
 * @returns {import("../router.js").Page}
 */
export function searchPage(container, context) {
  document.title = "Search – Engage";
  let alive = true;
  let ticket = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {Promise<import("../api.js").Counts>} */
  const counts = getCounts();
  const input = h("input", { id: "search-q", name: "q", type: "search", autocomplete: "off" });
  input.placeholder = "Search every product's messages";
  input.value = context.query.get("q") ?? "";
  const results = h("div", { class: "search-results", "aria-live": "polite" });
  container.append(
    h(
      "div",
      { class: "page" },
      h("h1", { class: "page-title" }, "Search"),
      h(
        "form",
        {
          role: "search",
          "aria-label": "Search every product",
          onsubmit: (/** @type {Event} */ e) => e.preventDefault(),
        },
        h("label", { class: "visually-hidden", for: "search-q" }, "Search messages"),
        input,
      ),
      results,
    ),
  );

  async function load() {
    const q = input.value.trim();
    const mine = ++ticket;
    if (!q) {
      replace(results, emptyState("Type to search every product's messages."));
      return;
    }
    try {
      const [{ byProduct }, page] = await Promise.all([counts, listItems({ q })]);
      if (!alive || mine !== ticket) return;
      if (page.items.length === 0) {
        replace(results, emptyState("Nothing matches that."));
        return;
      }
      replace(
        results,
        h(
          "ul",
          { class: "rows" },
          page.items.map(item => {
            const product = byProduct[item.product];
            const route = product?.route ?? item.product;
            return h(
              "li",
              { "data-id": item.id, "data-colour": product?.colour ?? "" },
              h(
                "a",
                {
                  class: "row-link",
                  href: `/${encodeURIComponent(route)}/inbox/${encodeURIComponent(item.id)}`,
                  "data-link": "",
                },
                h("span", { class: "swatch", "aria-hidden": "true" }),
                h(
                  "span",
                  { class: "row-body" },
                  h(
                    "span",
                    { class: "row-top" },
                    h("span", { class: "row-title" }, itemTitle(item)),
                    h("span", { class: "row-time" }, formatDay(item.lastActivityAt)),
                  ),
                  item.preview && h("span", { class: "row-preview" }, item.preview),
                  h("span", { class: "row-product" }, item.productName),
                ),
              ),
            );
          }),
        ),
      );
    } catch (error) {
      if (alive && mine === ticket) replace(results, failure(/** @type {Error} */ (error).message));
    }
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim();
      navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { replace: true });
    }, SEARCH_DELAY_MS);
  });
  load();
  input.focus();

  return {
    update(next) {
      const q = next.query.get("q") ?? "";
      if (q !== input.value.trim()) input.value = q;
      load();
    },
    destroy() {
      alive = false;
      clearTimeout(timer);
    },
  };
}
