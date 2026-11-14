/** @typedef {Node | string | null | undefined | false} Child */

/**
 * Builds an element. Strings become text nodes, so nothing passed in is ever parsed as markup.
 * @template {keyof HTMLElementTagNameMap} T
 * @param {T} tag
 * @param {Record<string, unknown> | null} [attributes]
 * @param {...(Child | Child[])} children
 * @returns {HTMLElementTagNameMap[T]}
 */
export function h(tag, attributes, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") {
      element.addEventListener(name.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
    } else if (name === "class") {
      element.className = String(value);
    } else if (value === true) {
      element.setAttribute(name, "");
    } else {
      element.setAttribute(name, String(value));
    }
  }
  append(element, children);
  return element;
}

/**
 * @param {ParentNode} parent
 * @param {(Child | Child[])[]} children
 */
export function append(parent, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

/**
 * @param {ParentNode} parent
 * @param {...(Child | Child[])} children
 */
export function replace(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
}

/** @param {string} text */
export const emptyState = text => h("p", { class: "empty" }, text);

/** @param {string} text */
export const loading = (text = "Loading…") => h("p", { class: "muted", role: "status" }, text);

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
export const failure = text => h("p", { class: "error", role: "alert" }, text);

/**
 * @param {string} href
 * @param {...(Child | Child[])} children
 */
export const link = (href, ...children) => h("a", { href, "data-link": "" }, ...children);

/** @returns {boolean} */
export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Runs a button's async action once at a time, disabling it while it works.
 * @param {HTMLButtonElement} button
 * @param {() => Promise<void>} action
 */
export function guarded(button, action) {
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
