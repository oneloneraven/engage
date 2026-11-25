import { getProduct } from "../api.js";
import { failure, h, loading, replace, setupState } from "../dom.js";
import { formatTime, monitorWord } from "../format.js";
import { engagementBlock } from "./home.js";

/**
 * @typedef {{ slug: string, name: string, route: string }} PageProduct
 * @typedef {(body: HTMLElement, detail: import("../api.js").ProductDetail) => void} Draw
 */

/**
 * A hub page drawn from the product's detail, fetched once.
 * @param {HTMLElement} container
 * @param {PageProduct} product
 * @param {string} title
 * @param {Draw} draw
 * @returns {import("../router.js").Page}
 */
function detailPage(container, product, title, draw) {
  document.title = `${title} – ${product.name} – Engage`;
  const body = h("div", null, loading());
  container.append(
    h(
      "section",
      { class: "page signal-page", "aria-labelledby": "signal-title" },
      h("h2", { id: "signal-title", class: "visually-hidden" }, title),
      body,
    ),
  );
  let alive = true;
  getProduct(product.route)
    .then(detail => {
      if (alive) draw(body, detail);
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

/**
 * Each of a product's monitors with its status, under the product's health.
 * @param {HTMLElement} container
 * @param {{ product: PageProduct }} options
 */
export const healthPage = (container, { product }) =>
  detailPage(container, product, "Health", (body, { health }) => {
    if (health.monitors.length === 0) {
      replace(
        body,
        setupState(
          `Each of ${product.name}'s monitors with its status, and why it's not healthy when it isn't.`,
          "No monitors yet.",
          "health",
          "health-and-engagement.md#1-health-from-better-stack",
        ),
      );
      return;
    }
    replace(
      body,
      h(
        "div",
        { class: "health-summary" },
        health.reason && h("p", null, health.reason),
        health.checkedAt &&
          h(
            "p",
            { class: "muted" },
            "Checked ",
            h("time", { datetime: health.checkedAt }, formatTime(health.checkedAt)),
          ),
      ),
      h(
        "ul",
        { class: "monitors", "aria-label": "Monitors" },
        health.monitors.map(monitor =>
          h(
            "li",
            { "data-status": monitor.status },
            h("span", { class: "dot", "aria-hidden": "true" }),
            h("span", { class: "monitor-name" }, monitor.name),
            h("span", { class: "monitor-status" }, monitorWord(monitor.status)),
            h(
              "a",
              { class: "button", href: monitor.url, target: "_blank", rel: "noopener noreferrer" },
              "Open in Better Stack",
              h("span", { class: "visually-hidden" }, ` for ${monitor.name}`),
            ),
          ),
        ),
      ),
    );
  });

/**
 * Each of a product's usage figures with 90 days of its line.
 * @param {HTMLElement} container
 * @param {{ product: PageProduct }} options
 */
export const usagePage = (container, { product }) =>
  detailPage(container, product, "Usage", (body, { usage }) => {
    if (usage.length === 0) {
      replace(
        body,
        setupState(
          `How many people use ${product.name}, each figure with its last 90 days.`,
          "No usage source yet.",
          "engagement",
          "health-and-engagement.md",
        ),
      );
      return;
    }
    replace(
      body,
      h(
        "ul",
        { class: "usage" },
        usage.map(metric =>
          h(
            "li",
            { class: "card" },
            engagementBlock(metric),
            h("p", { class: "muted series-span" }, "The line shows each day of the last 90."),
          ),
        ),
      ),
    );
  });
