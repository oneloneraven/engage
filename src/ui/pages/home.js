import { decideRelease, getCounts, listItems, listReleases } from "../api.js";
import { emptyState, failure, guarded, h, icon, link, loading, replace } from "../dom.js";
import { formatToday, itemTitle, kindLabel, verdict, verdictSummary, waitedFor } from "../format.js";

const REPLY_ICON = ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 6 6v5"];
const RELEASE_ICON = ["M12 3v12", "m8 11 4 4 4-4", "M4 17v3h16v-3"];
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
 * @param {import("../api.js").Release} release
 * @param {string} colour
 * @param {() => void} onDecided
 */
function releaseRow(release, colour, onDecided) {
  const href = `/releases/${encodeURIComponent(release.id)}`;
  const title = `${release.productName} ${release.ref ?? release.sha.slice(0, 7)} is waiting to go to ${release.environment}`;
  const status = h("div", { class: "status" });
  const approve = guarded(h("button", { type: "button", class: "attention" }, "Approve release"), async () => {
    replace(status);
    try {
      await decideRelease(release.id, "approve", "");
      onDecided();
    } catch (error) {
      replace(status, failure(/** @type {Error} */ (error).message));
    }
  });
  return h(
    "li",
    { class: "queue-row release-row", "data-colour": colour },
    h("span", { class: "tile" }, icon(...RELEASE_ICON)),
    h(
      "div",
      { class: "grow" },
      link(href, title),
      h("p", { class: "muted" }, `${release.repo}. Waiting ${waitedFor(release.createdAt)}.`),
      status,
    ),
    h("div", { class: "buttons" }, h("a", { class: "button", href, "data-link": "" }, "Review"), approve),
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

  const draw = () =>
    Promise.all([getCounts(), listItems({ state: "reply-owed" }), listReleases({ state: "pending" })])
      .then(([counts, owed, waiting]) => {
        if (!alive) return;
        const sweep = !swept;
        swept = true;
        const summary = verdictSummary(counts);
        const colourOf = (/** @type {string} */ slug) => counts.byProduct[slug]?.colour ?? "";
        replace(
          root,
          h(
            "div",
            { class: "home-top" },
            h("p", { class: "muted" }, formatToday(new Date())),
            h(
              "a",
              { class: "button", href: "/inbox?search", "data-link": "" },
              icon(...SEARCH_ICON),
              "Search messages",
            ),
          ),
          h(
            "section",
            { class: "hero", "aria-labelledby": "verdict" },
            h(
              "h1",
              { id: "verdict", class: "verdict" },
              h("span", { class: `verdict-text${sweep ? " sweep" : ""}` }, verdict(counts)),
            ),
            summary && h("p", { class: "summary" }, summary),
          ),
          h(
            "section",
            { "aria-labelledby": "needs-you" },
            h("h2", { id: "needs-you", class: "visually-hidden" }, "Needs you"),
            owed.items.length === 0 && waiting.releases.length === 0
              ? emptyState("Nothing needs you. New feedback lands here and pings Discord.")
              : h(
                  "ul",
                  { class: "queue" },
                  waiting.releases.map(release => releaseRow(release, colourOf(release.product), draw)),
                  owed.items.map(item => needsRow(item, colourOf(item.product))),
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
  draw();

  return {
    update() {},
    destroy() {
      alive = false;
    },
  };
}
