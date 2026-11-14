import { getCounts, listItems } from "../api.js";
import { emptyState, failure, h, link, loading, replace } from "../dom.js";
import { itemTitle, productName, verdict } from "../format.js";

let swept = false;

/** @param {import("../api.js").Counts} counts */
function countLink(counts, key, label, state) {
  return link(`/inbox?state=${state}`, h("span", { class: "numeral" }, String(counts[key])), h("span", null, label));
}

/**
 * @param {HTMLElement} container
 * @returns {import("../router.js").Page}
 */
export function homePage(container) {
  document.title = "Home – Engage";
  const root = h("div", { class: "page" }, loading());
  container.append(root);
  let alive = true;

  Promise.all([getCounts(), listItems({ state: "reply-owed" })])
    .then(([counts, owed]) => {
      if (!alive) return;
      const sweep = !swept;
      swept = true;
      replace(
        root,
        h(
          "h1",
          { class: "verdict" },
          h("span", { class: `verdict-text${sweep ? " sweep" : ""}` }, verdict(counts.replyOwed)),
        ),
        h(
          "section",
          { "aria-labelledby": "needs-you" },
          h("h2", { id: "needs-you", class: "section-title" }, "Needs you"),
          owed.items.length === 0
            ? emptyState("Nothing needs you. New feedback lands here and pings Discord.")
            : h(
                "ul",
                { class: "rows plain" },
                owed.items.map(item =>
                  h(
                    "li",
                    { class: "needs-row" },
                    link(
                      `/items/${encodeURIComponent(item.id)}`,
                      h("span", { class: "dot attention", "aria-hidden": "true" }),
                      h("span", { class: "grow" }, h("span", { class: "muted" }, "Reply owed: "), itemTitle(item)),
                      h("span", { class: "muted" }, productName(item.product)),
                    ),
                  ),
                ),
              ),
        ),
        h(
          "ul",
          { class: "counts", "aria-label": "Message counts" },
          h("li", null, countLink(counts, "new", "New", "new")),
          h("li", null, countLink(counts, "open", "Open", "open")),
          h("li", null, countLink(counts, "replyOwed", "Reply owed", "reply-owed")),
        ),
        h(
          "section",
          { "aria-labelledby": "products" },
          h("h2", { id: "products", class: "section-title" }, "Products"),
          h(
            "ul",
            { class: "cards" },
            Object.entries(counts.byProduct).map(([slug, perProduct]) =>
              h(
                "li",
                null,
                h(
                  "a",
                  {
                    class: "card",
                    href: `/inbox?product=${encodeURIComponent(slug)}`,
                    "data-link": "",
                    "data-product": slug,
                  },
                  h("h3", { class: "product-name" }, productName(slug)),
                  h("p", { class: "muted" }, `${perProduct.new} new · ${perProduct.open} open`),
                ),
              ),
            ),
          ),
        ),
      );
    })
    .catch(error => {
      if (alive) replace(root, h("h1", { class: "page-title" }, "Home"), failure(error.message));
    });

  return {
    update() {},
    destroy() {
      alive = false;
    },
  };
}
