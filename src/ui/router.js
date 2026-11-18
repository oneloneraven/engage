/**
 * @typedef {{ params: string[], query: URLSearchParams, path: string }} RouteContext
 * @typedef {{ update: (context: RouteContext) => void, destroy: () => void }} Page
 * @typedef {{ key: string, pattern: RegExp, mount: (container: HTMLElement, context: RouteContext) => Page }} Route
 */

const NAVIGATED = "engage:navigate";

/**
 * @param {string} url
 * @param {{ replace?: boolean }} [options]
 */
export function navigate(url, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.dispatchEvent(new Event(NAVIGATED));
}

/**
 * A small History API router. A route whose key matches the page already on screen updates it in place,
 * so the inbox list survives the move from one item to the next.
 * @param {{ container: HTMLElement, routes: Route[], notFound: (container: HTMLElement) => Page, onChange: (context: RouteContext) => void }} options
 */
export function createRouter({ container, routes, notFound, onChange }) {
  /** @type {{ key: string, page: Page } | null} */
  let active = null;

  function render() {
    const path = location.pathname;
    const query = new URLSearchParams(location.search);
    for (const route of routes) {
      const match = route.pattern.exec(path);
      if (!match) continue;
      let params;
      try {
        params = match.slice(1).map(decodeURIComponent);
      } catch {
        break;
      }
      const context = { params, query, path };
      if (active?.key === route.key) {
        active.page.update(context);
      } else {
        active?.page.destroy();
        container.replaceChildren();
        active = { key: route.key, page: route.mount(container, context) };
        container.focus();
      }
      onChange(context);
      return;
    }
    active?.page.destroy();
    container.replaceChildren();
    active = { key: "not-found", page: notFound(container) };
    container.focus();
    onChange({ params: [], query, path });
  }

  window.addEventListener("popstate", render);
  window.addEventListener(NAVIGATED, render);
  document.addEventListener("click", event => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = event.target instanceof Element ? event.target.closest("a[data-link]") : null;
    if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
    event.preventDefault();
    navigate(anchor.getAttribute("href") ?? "/");
  });

  return { start: render };
}
