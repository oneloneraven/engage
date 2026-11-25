import { getProductPage } from "../../api.js";
import { failure, h, loading, replace, setupState } from "../../dom.js";
import { formatCount } from "../../format.js";

const ADMIN_USAGE = "https://admin.climbinglogbook.com/usage";
const STATUSES = {
  flash: "Flash / Onsight",
  send: "Send / Redpoint",
  project: "Project",
  checkout: "Check out",
  archived: "Archived",
};
const DISCIPLINES = { boulder: "Boulder", sport: "Sport" };

/**
 * @param {Record<string, string>} labels
 * @param {string} key
 */
const labelOf = (labels, key) => (Object.hasOwn(labels, key) ? labels[key] : key);

/** @param {number} percent */
function shareBar(percent) {
  const fill = h("span");
  fill.style.width = `${percent}%`;
  return h("span", { class: "share-bar", "aria-hidden": "true" }, fill);
}

/**
 * One split of every climb, each part with its share as a bar.
 * @param {string} id
 * @param {string} title
 * @param {import("../../../products/climbing-logbook.js").Share[]} shares
 * @param {Record<string, string>} labels
 * @param {number} total
 */
function split(id, title, shares, labels, total) {
  return h(
    "section",
    { class: "card split-card", "aria-labelledby": id },
    h("h3", { id, class: "col-title" }, title),
    shares.length === 0
      ? h("p", { class: "quiet" }, "No climbs yet.")
      : h(
          "ul",
          { class: "shares" },
          shares.map(share => {
            const percent = total ? Math.round((share.climbs / total) * 100) : 0;
            return h(
              "li",
              null,
              h("span", { class: "share-label" }, labelOf(labels, share.key)),
              h("span", { class: "share-figure" }, `${percent}%, ${formatCount(share.climbs)}`),
              shareBar(percent),
            );
          }),
        ),
  );
}

/**
 * Climbing Logbook's climbs split by status and by discipline. Figures only: acting on climbs stays in its admin.
 * @type {import("../pages.js").PageMount}
 */
export function climbsPage(container, { product }) {
  const body = h("div", null, loading());
  container.append(
    h(
      "section",
      { class: "page signal-page", "aria-labelledby": "climbs-title" },
      h("h2", { id: "climbs-title", class: "visually-hidden" }, "Climbs"),
      body,
    ),
  );
  let alive = true;
  getProductPage(product.route, "climbs")
    .then((/** @type {import("../../api.js").Climbs} */ climbs) => {
      if (!alive) return;
      if (!climbs.setUp) {
        replace(
          body,
          setupState(
            `Every climb logged in ${product.name}, split by status and by discipline.`,
            `Engage can't read ${product.name}'s usage yet.`,
            "its usage figures",
            "health-and-engagement.md#3-climbing-logbooks-active-climbers",
          ),
        );
        return;
      }
      replace(
        body,
        h(
          "p",
          { class: "metric climbs-total" },
          h("span", { class: "numeral" }, formatCount(climbs.climbs)),
          h("span", { class: "muted" }, "Climbs logged, not counting internal accounts"),
        ),
        h(
          "div",
          { class: "splits" },
          split("climbs-status", "By status", climbs.statuses, STATUSES, climbs.climbs),
          split("climbs-discipline", "By discipline", climbs.disciplines, DISCIPLINES, climbs.climbs),
        ),
        h(
          "p",
          null,
          h(
            "a",
            { href: ADMIN_USAGE, target: "_blank", rel: "noopener noreferrer" },
            `Open Usage in ${product.name}'s admin`,
          ),
        ),
      );
    })
    .catch(error => {
      if (alive) replace(body, failure(error.message));
    });
  return {
    update() {},
    destroy() {
      alive = false;
    },
  };
}
