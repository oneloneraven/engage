import { decideRelease, getCounts, listItems, listReleases } from "../api.js";
import { emptyState, failure, guarded, h, icon, link, loading, replace } from "../dom.js";
import {
  betaText,
  changeText,
  formatCount,
  formatToday,
  healthWord,
  itemTitle,
  kindLabel,
  verdict,
  verdictSummary,
  waitedFor,
} from "../format.js";
import { sparkline } from "../sparkline.js";

const REPLY_ICON = ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 6 6v5"];
const RELEASE_ICON = ["M12 3v12", "m8 11 4 4 4-4", "M4 17v3h16v-3"];
const HEALTH_ICON = ["M3 12h4l3-8 4 16 3-8h4"];
const UNHEALTHY = ["failing", "degraded"];
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
 * @param {import("../api.js").ProductCounts} product
 * @param {string} colour
 */
function healthRow(product, colour) {
  const health = /** @type {import("../api.js").Signals} */ (product.signals).health;
  const title = `${product.name} is ${health.status}`;
  return h(
    "li",
    { class: "queue-row health-row", "data-colour": colour },
    h("span", { class: "tile" }, icon(...HEALTH_ICON)),
    h(
      "div",
      { class: "grow" },
      h("p", { class: "row-title" }, title),
      health.reason && h("p", { class: "muted" }, health.reason),
    ),
    health.link &&
      h(
        "a",
        { class: "button", href: health.link, target: "_blank", rel: "noopener noreferrer" },
        "Open in Better Stack",
        h("span", { class: "visually-hidden" }, ` for ${product.name}`),
      ),
  );
}

/** @param {import("../api.js").HealthSignal} health */
const healthPill = health =>
  h(
    "span",
    { class: "health-pill", "data-health": health.status },
    h("span", { class: "dot", "aria-hidden": "true" }),
    healthWord(health.status),
  );

/** @param {import("../api.js").EngagementSignal} engagement */
function engagementBlock(engagement) {
  const change = changeText(engagement.change);
  return h(
    "div",
    { class: "engagement" },
    h(
      "p",
      { class: "metric" },
      h("span", { class: "numeral" }, engagement.value === null ? "No data yet" : formatCount(engagement.value)),
      h("span", { class: "muted" }, engagement.label),
    ),
    sparkline(
      engagement.series.map(point => point.value),
      engagement.label,
    ),
    change && h("p", { class: "change muted" }, change),
  );
}

/**
 * @param {string} slug
 * @param {import("../api.js").ProductCounts} product
 */
function productPanel(slug, product) {
  const inbox = `/inbox?product=${encodeURIComponent(slug)}`;
  const signals = product.signals;
  const health = signals?.health;
  const showReason = health?.reason && !["healthy", "unmonitored"].includes(health.status);
  return h(
    "li",
    null,
    h(
      "article",
      { class: "card", "data-product": slug, "data-colour": product.colour ?? "" },
      h(
        "div",
        { class: "card-head" },
        h("h3", { class: "product-name" }, link(inbox, product.name)),
        health && healthPill(health),
      ),
      showReason && h("p", { class: "health-reason muted" }, health.reason),
      signals?.engagement && engagementBlock(signals.engagement),
      h(
        "ul",
        { class: "chips", "aria-label": `${product.name} messages and releases` },
        h("li", null, link(`${inbox}&state=new`, `${product.new} new`)),
        h("li", null, link(`${inbox}&state=open`, `${product.open} open`)),
        signals?.beta &&
          h(
            "li",
            null,
            h("span", { class: `beta-badge${signals.beta.amber ? " amber" : ""}` }, betaText(signals.beta)),
          ),
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
        const unhealthy = Object.values(counts.byProduct).filter(product =>
          UNHEALTHY.includes(product.signals?.health.status ?? ""),
        );
        const summary = verdictSummary({
          ...counts,
          unhealthy: unhealthy.map(product => ({
            name: product.name,
            status: /** @type {import("../api.js").Signals} */ (product.signals).health.status,
          })),
        });
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
            owed.items.length === 0 && waiting.releases.length === 0 && unhealthy.length === 0
              ? emptyState("Nothing needs you. New feedback lands here and pings Discord.")
              : h(
                  "ul",
                  { class: "queue" },
                  Object.entries(counts.byProduct)
                    .filter(([, product]) => unhealthy.includes(product))
                    .map(([slug, product]) => healthRow(product, colourOf(slug))),
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
