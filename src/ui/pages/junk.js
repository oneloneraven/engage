import { listItems, patchItem } from "../api.js";
import { emptyState, failure, guarded, h, loading, prefersReducedMotion, replace } from "../dom.js";
import { formatDay, itemTitle, kindLabel, productName } from "../format.js";

/**
 * @param {HTMLElement} container
 * @returns {import("../router.js").Page}
 */
export function junkPage(container) {
  document.title = "Junk – Engage";
  const status = h("div", { class: "status" });
  const list = h("ul", { class: "rows plain" });
  const body = h("div", null, loading());
  const more = h("button", { type: "button", class: "secondary", hidden: true }, "Show more");
  container.append(
    h(
      "div",
      { class: "page" },
      h("h1", { class: "page-title" }, "Junk"),
      h("p", { class: "muted" }, "Spam and anything you've marked as junk. Engage deletes it after 30 days."),
      status,
      body,
      more,
    ),
  );
  let alive = true;
  /** @type {string | null} */
  let cursor = null;

  /** @param {import("../api.js").ItemSummary} item */
  function row(item) {
    const li = h("li", { class: "junk-row", "data-id": item.id });
    const restore = guarded(h("button", { type: "button", class: "secondary" }, "Not junk"), async () => {
      status.replaceChildren();
      try {
        await patchItem(item.id, { junk: false });
      } catch (error) {
        status.replaceChildren(failure(/** @type {Error} */ (error).message));
        return;
      }
      li.classList.add("leaving");
      setTimeout(
        () => {
          li.remove();
          if (list.children.length === 0) showEmpty();
        },
        prefersReducedMotion() ? 0 : 150,
      );
    });
    li.append(
      h(
        "a",
        { class: "row-link", href: `/items/${encodeURIComponent(item.id)}`, "data-link": "" },
        h("span", { class: "row-title" }, itemTitle(item)),
        h(
          "span",
          { class: "muted" },
          `${productName(item.product)} · ${kindLabel(item.kind)} · ${formatDay(item.createdAt)}`,
        ),
      ),
      restore,
    );
    return li;
  }

  function showEmpty() {
    replace(body, emptyState("No junk. Anything Engage filters out as spam lands here."));
  }

  async function load() {
    try {
      const page = await listItems(cursor ? { state: "junk", cursor } : { state: "junk" });
      if (!alive) return;
      cursor = page.next;
      list.append(...page.items.map(row));
      if (list.children.length === 0) showEmpty();
      else replace(body, list);
      more.hidden = cursor === null;
    } catch (error) {
      if (alive) replace(body, failure(/** @type {Error} */ (error).message));
    }
  }

  guarded(more, load);
  load();

  return {
    update() {},
    destroy() {
      alive = false;
    },
  };
}
