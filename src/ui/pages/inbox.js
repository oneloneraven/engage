import { getCounts, listItems } from "../api.js";
import { emptyState, failure, guarded, h, prefersReducedMotion, replace } from "../dom.js";
import { formatDay, itemTitle, kindLabel } from "../format.js";
import { navigate } from "../router.js";
import { mountItem } from "./item.js";

const STATES = [
  ["", "Active"],
  ["new", "New"],
  ["open", "Open"],
  ["reply-owed", "Reply owed"],
  ["starred", "Starred"],
  ["archived", "Archived"],
  ["all", "Everything"],
];
const KINDS = [
  ["", "Any kind"],
  ["issue", "Issue reports"],
  ["feedback", "Feedback"],
  ["email", "Emails"],
];
const TARGET_ROWS = 25;
const SEARCH_DELAY_MS = 250;
const FADE_MS = 150;
const FILTER_NAMES = ["product", "kind", "state", "q"];
const CHIP_STATES = ["", "reply-owed"];

/**
 * @param {URLSearchParams} query
 * @returns {Record<string, string>}
 */
function filtersFrom(query) {
  return Object.fromEntries(FILTER_NAMES.map(name => [name, query.get(name) ?? ""]));
}

/** @param {Record<string, string>} filters */
function queryString(filters) {
  const query = new URLSearchParams();
  for (const name of FILTER_NAMES) if (filters[name]) query.set(name, filters[name]);
  return query.size > 0 ? `?${query}` : "";
}

/**
 * @param {string} name
 * @param {string} label
 * @param {string[][]} options
 */
function field(name, label, options) {
  const id = `filter-${name}`;
  const element = h("select", { id, name });
  setOptions(element, options);
  return { element, wrapper: h("div", { class: "field" }, h("label", { for: id }, label), element) };
}

/**
 * @param {HTMLSelectElement} element
 * @param {string[][]} options
 */
function setOptions(element, options) {
  const value = element.value;
  element.replaceChildren(...options.map(([optionValue, text]) => h("option", { value: optionValue }, text)));
  element.value = value;
}

/**
 * @param {HTMLElement} container
 * @param {import("../router.js").RouteContext} context
 * @returns {import("../router.js").Page}
 */
export function inboxPage(container, context) {
  document.title = "Inbox – Engage";
  let filters = filtersFrom(context.query);
  /** @type {string | null} */
  let itemId = context.params[0] ?? null;
  let openReply = context.query.has("reply");
  /** @type {string | null} */
  let cursor = null;
  let alive = true;
  let loadCount = 0;
  /** @type {Map<string, HTMLElement>} */
  const rows = new Map();
  /** @type {{ destroy: () => void } | null} */
  let itemPane = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let searchTimer;
  /** @type {{ slug: string, name: string, colour: string }[]} */
  let products = [];
  let newCount = 0;

  const heading = () => h(itemId ? "h2" : "h1", { class: "page-title" }, "Inbox");
  let title = heading();
  const list = h("ul", { class: "rows" });
  const listStatus = h("div", { class: "status" });
  const more = h("button", { type: "button", class: "secondary", hidden: true }, "Show more");
  const filterForm = h("form", { class: "filters", role: "search", "aria-label": "Filter the inbox" });
  const detail = h("section", { class: "detail-pane", "aria-label": "Item" });
  const split = h(
    "div",
    { class: "split" },
    h("section", { class: "list-pane", "aria-label": "Items" }, title, filterForm, listStatus, list, more),
    detail,
  );
  container.append(split);

  /** @param {Record<string, string> | undefined} [next] */
  function urlFor(next = filters, id = itemId) {
    return `${id ? `/items/${encodeURIComponent(id)}` : "/inbox"}${queryString(next)}`;
  }

  /** @param {{ archivedAt: string | null }} item */
  const visible = item => filters.state !== "" || filters.q !== "" || item.archivedAt === null;

  /** @param {string} slug */
  const colourOf = slug => products.find(product => product.slug === slug)?.colour ?? "";

  /** @param {import("../api.js").ItemSummary} item */
  function rowFor(item) {
    const unread = item.readAt === null && item.archivedAt === null;
    const current = item.id === itemId;
    const initial = [...(item.contactName?.trim() ?? "")][0]?.toUpperCase() ?? "?";
    const li = h(
      "li",
      { "data-id": item.id, "data-colour": colourOf(item.product), ...(unread && { "data-unread": "true" }) },
      h(
        "a",
        {
          class: `row-link${unread ? " unread" : ""}`,
          href: urlFor(filters, item.id),
          "data-link": "",
          ...(current && { "aria-current": "true" }),
        },
        h("span", { class: "avatar", "aria-hidden": "true" }, initial),
        h(
          "span",
          { class: "row-body" },
          h(
            "span",
            { class: "row-top" },
            h(
              "span",
              { class: "row-title" },
              unread && h("span", { class: "dot unread-dot", "aria-hidden": "true" }),
              unread && h("span", { class: "visually-hidden" }, "Unread: "),
              itemTitle(item),
            ),
            h("span", { class: "row-time" }, formatDay(item.lastActivityAt)),
          ),
          h(
            "span",
            { class: "row-tags" },
            h("span", { class: "row-product" }, item.productName),
            h("span", { class: "tag" }, kindLabel(item.kind)),
            item.replyOwedAt && h("span", { class: "tag owed" }, "Reply owed"),
            item.starred && h("span", { class: "tag" }, "Starred"),
            item.archivedAt && h("span", { class: "tag" }, "Archived"),
          ),
        ),
      ),
    );
    return li;
  }

  /** @param {import("../api.js").ItemSummary[]} items */
  function reconcile(items) {
    const wanted = new Set(items.map(item => item.id));
    /** @type {HTMLElement[]} */
    const ordered = items.map(item => {
      const fresh = rowFor(item);
      rows.set(item.id, fresh);
      return fresh;
    });
    /** @type {[number, Element][]} */
    const leaving = [];
    [...list.children].forEach((child, index) => {
      const id = child.getAttribute("data-id") ?? "";
      if (wanted.has(id) || child.classList.contains("leaving")) return;
      child.classList.add("leaving");
      rows.delete(id);
      leaving.push([index, child]);
      setTimeout(() => child.remove(), prefersReducedMotion() ? 0 : FADE_MS);
    });
    for (const [index, child] of leaving)
      ordered.splice(Math.min(index, ordered.length), 0, /** @type {HTMLElement} */ (child));
    list.replaceChildren(...ordered);
  }

  /**
   * @param {number} target
   * @param {string | null} from
   */
  async function fetchRows(target, from) {
    const params = { product: filters.product, kind: filters.kind, q: filters.q };
    const state = filters.state === "all" ? undefined : filters.state || undefined;
    /** @type {import("../api.js").ItemSummary[]} */
    const collected = [];
    let next = from;
    do {
      const page = await listItems({ ...params, state, cursor: next ?? undefined });
      collected.push(...page.items.filter(visible));
      next = page.next;
    } while (next && collected.length < target);
    return { collected, next };
  }

  async function load() {
    const ticket = ++loadCount;
    listStatus.replaceChildren();
    try {
      const target = Math.max(TARGET_ROWS, rows.size);
      const result = await fetchRows(target, null);
      if (!alive || ticket !== loadCount) return;
      cursor = result.next;
      reconcile(result.collected);
      more.hidden = cursor === null;
      if (result.collected.length === 0) {
        replace(
          listStatus,
          emptyState(
            filters.state || filters.q || filters.product || filters.kind
              ? "Nothing matches those filters."
              : "Nothing in the inbox. New feedback lands here and pings Discord.",
          ),
        );
      }
    } catch (error) {
      if (alive && ticket === loadCount) replace(listStatus, failure(/** @type {Error} */ (error).message));
    }
  }

  guarded(more, async () => {
    if (!cursor) return;
    const ticket = loadCount;
    try {
      const result = await fetchRows(TARGET_ROWS, cursor);
      if (!alive || ticket !== loadCount) return;
      cursor = result.next;
      for (const item of result.collected) {
        const fresh = rowFor(item);
        rows.set(item.id, fresh);
        list.append(fresh);
      }
      more.hidden = cursor === null;
    } catch (error) {
      replace(listStatus, failure(/** @type {Error} */ (error).message));
    }
  });

  /** @param {Record<string, string>} patch */
  function setFilters(patch) {
    filters = { ...filters, ...patch };
    navigate(urlFor(), { replace: true });
    syncFilters();
    load();
  }

  /** @param {string} name @param {string} value */
  const setFilter = (name, value) => setFilters({ [name]: value });

  const kindField = field("kind", "Kind", KINDS);
  const stateField = field("state", "Show", STATES);
  const search = h("input", { id: "filter-q", name: "q", type: "search", autocomplete: "off" });
  const controls = { kind: kindField.element, state: stateField.element, q: search };
  for (const [name, control] of Object.entries(controls)) {
    if (name === "q") continue;
    control.addEventListener("change", () => setFilter(name, control.value));
  }
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setFilter("q", search.value.trim()), SEARCH_DELAY_MS);
  });
  filterForm.addEventListener("submit", event => event.preventDefault());

  const chips = h("div", { class: "filter-chips", role: "group", "aria-label": "Show" });
  const moreFilters = h(
    "div",
    { id: "more-filters", class: "more-filters", hidden: true },
    kindField.wrapper,
    stateField.wrapper,
  );
  const moreToggle = h(
    "button",
    { type: "button", class: "chip", "aria-expanded": "false", "aria-controls": "more-filters" },
    "More",
  );
  moreToggle.addEventListener("click", () => {
    const open = moreFilters.hidden;
    moreFilters.hidden = !open;
    moreToggle.setAttribute("aria-expanded", String(open));
  });
  filterForm.append(
    h("div", { class: "field" }, h("label", { class: "visually-hidden", for: "filter-q" }, "Search messages"), search),
    chips,
    moreFilters,
  );
  search.placeholder = "Search messages";

  /**
   * @param {string} label
   * @param {boolean} pressed
   * @param {() => void} onPress
   * @param {string} [colour]
   */
  function chip(label, pressed, onPress, colour) {
    const button = h(
      "button",
      {
        type: "button",
        class: "chip",
        "aria-pressed": String(pressed),
        ...(colour !== undefined && { "data-colour": colour }),
      },
      colour !== undefined && h("span", { class: "swatch", "aria-hidden": "true" }),
      label,
    );
    button.addEventListener("click", onPress);
    return button;
  }

  function drawChips() {
    const focused = chips.contains(document.activeElement) ? document.activeElement?.textContent : null;
    replace(
      chips,
      chip("All", !filters.product && !filters.state, () => setFilters({ product: "", state: "" })),
      products.map(({ slug, name, colour }) =>
        chip(name, filters.product === slug, () => setFilter("product", filters.product === slug ? "" : slug), colour),
      ),
      chip("Reply owed", filters.state === "reply-owed", () =>
        setFilter("state", filters.state === "reply-owed" ? "" : "reply-owed"),
      ),
      moreToggle,
    );
    if (focused)
      /** @type {HTMLElement | undefined} */ (
        [...chips.querySelectorAll("button")].find(button => button.textContent === focused)
      )?.focus();
  }

  function syncFilters() {
    for (const [name, control] of Object.entries(controls)) {
      if (control.value !== filters[name]) control.value = filters[name];
    }
    if (filters.kind || !CHIP_STATES.includes(filters.state)) {
      moreFilters.hidden = false;
      moreToggle.setAttribute("aria-expanded", "true");
    }
    drawChips();
  }
  syncFilters();
  getCounts()
    .then(counts => {
      if (!alive) return;
      products = Object.entries(counts.byProduct).map(([slug, { name, colour }]) => ({
        slug,
        name,
        colour: colour ?? "",
      }));
      newCount = counts.new;
      drawChips();
      if (itemId === null) drawItem();
      load();
    })
    .catch(() => {});

  function drawItem() {
    split.classList.toggle("has-item", itemId !== null);
    const next = heading();
    title.replaceWith(next);
    title = next;
    itemPane?.destroy();
    itemPane = null;
    if (itemId === null) {
      replace(
        detail,
        h(
          "div",
          { class: "empty-pane" },
          emptyState(
            newCount > 0
              ? `${newCount} new ${newCount === 1 ? "message is" : "messages are"} waiting. Pick one from the list to read it.`
              : "Pick a message from the list to read it.",
          ),
        ),
      );
      return;
    }
    itemPane = mountItem(detail, itemId, {
      backHref: urlFor(filters, null),
      openReply,
      onChanged: () => load(),
      onGone: () => {
        navigate(urlFor(filters, null), { replace: true });
        load();
      },
    });
  }

  drawItem();
  load();
  if (context.query.has("search")) search.focus();

  return {
    update(next) {
      const nextId = next.params[0] ?? null;
      openReply = next.query.has("reply");
      const nextFilters = filtersFrom(next.query);
      const filtersChanged = FILTER_NAMES.some(name => nextFilters[name] !== filters[name]);
      const itemChanged = nextId !== itemId;
      filters = nextFilters;
      itemId = nextId;
      if (itemChanged) {
        for (const [id, li] of rows) {
          if (id === itemId) li.querySelector("a")?.setAttribute("aria-current", "true");
          else li.querySelector("a")?.removeAttribute("aria-current");
        }
        drawItem();
      }
      if (filtersChanged) {
        syncFilters();
        load();
      }
    },
    destroy() {
      alive = false;
      clearTimeout(searchTimer);
      itemPane?.destroy();
    },
  };
}
