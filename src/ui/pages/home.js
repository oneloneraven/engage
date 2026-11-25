import { decideRelease, getCounts, listItems, listReleases } from "../api.js";
import { emptyState, failure, guarded, h, icon, link, loading, replace } from "../dom.js";
import {
  betaText,
  changeText,
  formatCount,
  formatToday,
  healthWord,
  hubSummary,
  itemTitle,
  kindLabel,
  verdict,
  waitedFor,
} from "../format.js";
import { sparkline } from "../sparkline.js";

const REPLY_ICON = ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 6 6v5"];
const RELEASE_ICON = ["M12 3v12", "m8 11 4 4 4-4", "M4 17v3h16v-3"];
const HEALTH_ICON = ["M3 12h4l3-8 4 16 3-8h4"];
const UNHEALTHY = ["failing", "degraded"];
const OWED_SHOWN = 3;

let swept = false;

/**
 * @typedef {import("../api.js").ProductCounts} ProductCounts
 * @typedef {import("../api.js").ItemSummary} ItemSummary
 * @typedef {import("../api.js").Release} Release
 */

/** @param {ItemSummary} item */
function owedRow(item) {
  const href = `/items/${encodeURIComponent(item.id)}`;
  const title = itemTitle(item);
  return h(
    "li",
    { class: "queue-row" },
    h("span", { class: "tile" }, icon(...REPLY_ICON)),
    h(
      "div",
      { class: "grow" },
      link(href, title),
      h("p", { class: "muted" }, `${kindLabel(item.kind)}. You owe a reply.`),
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
 * @param {Release} release
 * @param {() => void} onDecided
 */
function releaseRow(release, onDecided) {
  const href = `/releases/${encodeURIComponent(release.id)}`;
  const title = `${release.ref ?? release.sha.slice(0, 7)} is waiting to go to ${release.environment}`;
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
    { class: "queue-row release-row" },
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

/** @param {ProductCounts} product */
function healthRow(product) {
  const health = /** @type {import("../api.js").Signals} */ (product.signals).health;
  return h(
    "li",
    { class: "queue-row health-row" },
    h("span", { class: "tile" }, icon(...HEALTH_ICON)),
    h(
      "div",
      { class: "grow" },
      h("p", { class: "row-title" }, `${product.name} is ${health.status}`),
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
 * One product's card: what needs you on the left, how it's doing on the right.
 * @param {string} slug
 * @param {ProductCounts} product
 * @param {{ owed: ItemSummary[], releases: Release[] }} needs
 * @param {() => void} redraw
 */
function productCard(slug, product, needs, redraw) {
  const inbox = `/inbox?product=${encodeURIComponent(slug)}`;
  const signals = product.signals;
  const health = signals?.health;
  const unhealthy = UNHEALTHY.includes(health?.status ?? "");
  const rows = [
    unhealthy && healthRow(product),
    ...needs.releases.map(release => releaseRow(release, redraw)),
    ...needs.owed.slice(0, OWED_SHOWN).map(owedRow),
  ].filter(Boolean);
  const titleId = `product-${slug}`;
  return h(
    "li",
    null,
    h(
      "article",
      {
        class: `card hub-card${rows.length ? " needs" : ""}`,
        "data-product": slug,
        "data-colour": product.colour ?? "",
        "aria-labelledby": titleId,
      },
      h(
        "div",
        { class: "card-head" },
        h(
          "h2",
          { class: "product-name", id: titleId },
          h("span", { class: "swatch", "aria-hidden": "true" }),
          link(inbox, product.name),
        ),
        health && healthPill(health),
      ),
      h(
        "div",
        { class: "hub-cols" },
        h(
          "section",
          { class: "hub-needs", "aria-label": `${product.name}: needs you` },
          h("h3", { class: "col-title" }, "Needs you"),
          rows.length ? h("ul", { class: "queue" }, rows) : h("p", { class: "quiet" }, "Nothing needs you here."),
          (product.replyOwed ?? 0) > OWED_SHOWN &&
            h("p", null, link(`${inbox}&state=reply-owed`, `See all ${product.replyOwed} replies owed in the inbox`)),
          h(
            "ul",
            { class: "chips", "aria-label": `${product.name} messages` },
            h("li", null, link(`${inbox}&state=new`, `${product.new} new`)),
            h("li", null, link(`${inbox}&state=open`, `${product.open} open`)),
          ),
        ),
        h(
          "section",
          { class: "hub-doing", "aria-label": `${product.name}: how it's doing` },
          h("h3", { class: "col-title" }, "How it's doing"),
          signals?.engagement
            ? engagementBlock(signals.engagement)
            : h("p", { class: "quiet" }, "No usage figures yet."),
          health?.reason && !unhealthy && h("p", { class: "health-reason muted" }, health.reason),
          signals?.beta &&
            h(
              "p",
              null,
              h("span", { class: `beta-badge${signals.beta.amber ? " amber" : ""}` }, betaText(signals.beta)),
            ),
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
        const products = Object.entries(counts.byProduct).map(([slug, product]) => {
          const needs = {
            owed: owed.items.filter(item => item.product === slug),
            releases: waiting.releases.filter(release => release.product === slug),
          };
          const unhealthy = UNHEALTHY.includes(product.signals?.health.status ?? "") ? 1 : 0;
          const count = unhealthy + needs.releases.length + (product.replyOwed ?? 0);
          return { slug, product, needs, count };
        });
        const summary = hubSummary(products.map(({ product, count }) => ({ name: product.name, needs: count })));
        replace(
          root,
          h(
            "section",
            { class: "hero", "aria-labelledby": "verdict" },
            h("p", { class: "date muted" }, formatToday(new Date())),
            h(
              "h1",
              { id: "verdict", class: "verdict" },
              h("span", { class: `verdict-text${sweep ? " sweep" : ""}` }, verdict(counts)),
            ),
            h("p", { class: "summary" }, summary || "Nothing needs you. New feedback lands here and pings Discord."),
          ),
          products.length === 0
            ? emptyState("No products yet. Add one to the registry and it appears here.")
            : h(
                "ul",
                { class: "hub-cards", "aria-label": "Your products" },
                products.map(({ slug, product, needs }) => productCard(slug, product, needs, draw)),
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
