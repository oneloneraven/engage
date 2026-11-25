import { getCounts, listItems } from "../api.js";
import { emptyState, failure, h, icon, link, loading, replace } from "../dom.js";
import { formatToday, itemTitle, kindLabel, verdict, verdictSummary } from "../format.js";

const REPLY_ICON = ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 6 6v5"];
const SEARCH_ICON = ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "m20 20-3.5-3.5"];

let swept = false;

/**
 * @param {string} href
 * @param {number} count
 * @param {string} label
 */
const countPill = (href, count, label) =>
  h("li", null, link(href, h("span", { class: "numeral" }, String(count)), h("span", null, label)));

/**
 * @param {import("../api.js").ItemSummary} item
 * @param {string} colour
 */
function needsRow(item, colour) {
  const href = `/items/${encodeURIComponent(item.id)}`;
  const title = itemTitle(item);
  return h(
    "li",
    { class: "queue-row", "data-colour": colour },
    h("span", { class: "tile" }, icon(...REPLY_ICON)),
    h(
      "div",
      { class: "grow" },
      link(href, title),
      h("p", { class: "muted" }, `${item.productName}, ${kindLabel(item.kind).toLowerCase()}. You owe a reply.`),
    ),
    h(
      "a",
      { class: "button primary", href: `${href}?reply`, "data-link": "" },
      "Reply",
      h("span", { class: "visually-hidden" }, ` to ${title}`),
    ),
  );
}

/**
 * @param {string} slug
 * @param {{ name: string, colour: string | null, new: number, open: number }} product
 */
function productPanel(slug, product) {
  const inbox = `/inbox?product=${encodeURIComponent(slug)}`;
  return h(
    "li",
    null,
    h(
      "article",
      { class: "card", "data-product": slug, "data-colour": product.colour ?? "" },
      h("h3", { class: "product-name" }, link(inbox, product.name)),
      h(
        "ul",
        { class: "chips", "aria-label": `${product.name} messages` },
        h("li", null, link(`${inbox}&state=new`, `${product.new} new`)),
        h("li", null, link(`${inbox}&state=open`, `${product.open} open`)),
      ),
    ),
  );
}

/**
 * @param {HTMLElement} container
 * @returns {import("../router.js").Page}
 */
export function homePage(container) {
  document.title = "Home – Engage";
  const root = h("div", { class: "page home" }, loading());
  container.append(root);
  let alive = true;

  Promise.all([getCounts(), listItems({ state: "reply-owed" })])
    .then(([counts, owed]) => {
      if (!alive) return;
      const sweep = !swept;
      swept = true;
      const summary = verdictSummary(counts.replyOwed);
      replace(
        root,
        h(
          "div",
          { class: "home-top" },
          h("p", { class: "muted" }, formatToday(new Date())),
          h("a", { class: "button", href: "/inbox?search", "data-link": "" }, icon(...SEARCH_ICON), "Search messages"),
        ),
        h(
          "section",
          { class: "hero", "aria-labelledby": "verdict" },
          h(
            "h1",
            { id: "verdict", class: "verdict" },
            h("span", { class: `verdict-text${sweep ? " sweep" : ""}` }, verdict(counts.replyOwed)),
          ),
          summary && h("p", { class: "summary" }, summary),
        ),
        h(
          "section",
          { "aria-labelledby": "needs-you" },
          h("h2", { id: "needs-you", class: "visually-hidden" }, "Needs you"),
          owed.items.length === 0
            ? emptyState("Nothing needs you. New feedback lands here and pings Discord.")
            : h(
                "ul",
                { class: "queue" },
                owed.items.map(item => needsRow(item, counts.byProduct[item.product]?.colour ?? "")),
              ),
          owed.next &&
            h("p", null, link("/inbox?state=reply-owed", `See all ${counts.replyOwed} replies owed in the inbox`)),
        ),
        h(
          "ul",
          { class: "counts", "aria-label": "Message counts" },
          countPill("/inbox?state=new", counts.new, "new"),
          countPill("/inbox?state=open", counts.open, "open"),
          countPill(
            "/inbox?state=reply-owed",
            counts.replyOwed,
            counts.replyOwed === 1 ? "reply owed" : "replies owed",
          ),
        ),
        h(
          "section",
          { "aria-labelledby": "products" },
          h("h2", { id: "products", class: "section-title" }, "Your products"),
          h(
            "ul",
            { class: "cards" },
            Object.entries(counts.byProduct).map(([slug, product]) => productPanel(slug, product)),
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
