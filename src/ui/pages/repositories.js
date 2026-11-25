import { getCounts, getRepositories } from "../api.js";
import { failure, h, loading, replace } from "../dom.js";
import { cellWord, checksFailing, formatTime } from "../format.js";

const MARKS = { pass: "✓", fail: "✕", unknown: "?", skipped: "↷", "n/a": "–" };
const RUN_ERRORS = {
  "rules-unavailable": "Engage couldn't read bootstrap's rules",
  "rules-malformed": "bootstrap's rules file isn't valid",
  "repositories-unavailable": "Engage couldn't list the repositories",
  "github-app-unavailable": "Engage's GitHub App isn't set up",
};

/**
 * A reason with its `quoted` names as code.
 * @param {string} text
 */
const withCode = text => text.split("`").map((part, n) => (n % 2 ? h("code", null, part) : part));

/** @param {string} status */
const markOf = status => MARKS[/** @type {keyof typeof MARKS} */ (status)] ?? "?";

/**
 * @param {import("../api.js").Conformance} conformance
 */
function statusLine({ lastRun, lastError }) {
  const lines = [];
  if (!lastRun) lines.push("Engage hasn't checked repositories yet. The first check runs at 03:17 UTC.");
  else {
    lines.push(
      `Checked ${formatTime(lastRun.finishedAt)} against bootstrap's rules${lastRun.rulesVersion === null ? "" : `, version ${lastRun.rulesVersion}`}.`,
    );
    if (lastRun.stale) lines.push("That's over 36 hours ago, so these results may be out of date.");
  }
  if (lastError && (!lastRun || lastError.at > lastRun.finishedAt)) {
    const said = Object.hasOwn(RUN_ERRORS, lastError.error)
      ? RUN_ERRORS[/** @type {keyof typeof RUN_ERRORS} */ (lastError.error)]
      : "something went wrong";
    lines.push(`The last check, ${formatTime(lastError.at)}, didn't finish: ${said}.`);
  }
  return h("p", { class: "muted run-line" }, lines.join(" "));
}

/**
 * Every repository against bootstrap's checks: a grid on wide screens, a card per repository on narrow ones.
 * @param {HTMLElement} container
 * @returns {import("../router.js").Page}
 */
export function repositoriesPage(container) {
  document.title = "Repositories – Engage";
  const body = h("div", null, loading());
  container.append(
    h(
      "div",
      { class: "page repositories" },
      h("h1", { class: "page-title" }, "Repositories"),
      h("p", null, "Each repository against what bootstrap set up for it. Engage only reads; bootstrap fixes."),
      body,
    ),
  );
  let alive = true;

  Promise.all([getRepositories(), getCounts()])
    .then(([conformance, counts]) => {
      if (!alive) return;
      const productName = (/** @type {string | null} */ slug) =>
        slug === null ? "No product" : (counts.byProduct[slug]?.name ?? slug);
      const detail = h("div", { class: "cell-detail", "aria-live": "polite" });
      const { checks, repositories } = conformance;

      /** @type {(string | null)[]} */
      const groups = [];
      for (const r of repositories) if (!groups.includes(r.product)) groups.push(r.product);

      /**
       * @param {import("../api.js").Conformance["repositories"][number]} repository
       * @param {{ id: string, title: string }} check
       */
      function cellButton(repository, check) {
        const cell = repository.cells[check.id] ?? { status: "unknown", reason: "Not checked yet", link: null };
        const button = h(
          "button",
          { type: "button", class: "cell", "data-status": cell.status },
          h("span", { class: "mark", "aria-hidden": "true" }, markOf(cell.status)),
          h("span", { class: "cell-word" }, cellWord(cell.status)),
          h("span", { class: "visually-hidden" }, `: ${check.title}, ${repository.name}`),
        );
        button.addEventListener("click", () => {
          replace(
            detail,
            h("h2", { class: "section-title", tabindex: "-1" }, `${repository.name}: ${check.title}`),
            h(
              "p",
              null,
              h("strong", null, cellWord(cell.status)),
              cell.reason ? [". ", ...withCode(cell.reason)] : ".",
            ),
            cell.link &&
              h("p", null, h("a", { href: cell.link, target: "_blank", rel: "noopener noreferrer" }, "Fix in GitHub")),
            h("p", { class: "muted" }, `Checked ${formatTime(repository.checkedAt)}.`),
          );
          /** @type {HTMLElement | null} */ (detail.querySelector("h2"))?.focus();
        });
        return button;
      }

      if (repositories.length === 0) {
        replace(body, statusLine(conformance), h("p", { class: "empty" }, "No repositories have been checked yet."));
        return;
      }

      const table = h(
        "div",
        { class: "grid-scroll" },
        h(
          "table",
          { class: "conformance-grid" },
          h("caption", { class: "visually-hidden" }, "Each repository against bootstrap's checks"),
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              h("th", { scope: "col" }, "Repository"),
              checks.map(check => h("th", { scope: "col" }, check.title)),
            ),
          ),
          groups.map(group =>
            h(
              "tbody",
              null,
              h(
                "tr",
                { class: "group" },
                h("th", { scope: "colgroup", colspan: String(checks.length + 1) }, productName(group)),
              ),
              repositories
                .filter(r => r.product === group)
                .map(repository =>
                  h(
                    "tr",
                    { id: repository.repo, "data-failing": String(repository.failing) },
                    h(
                      "th",
                      { scope: "row" },
                      h(
                        "a",
                        { href: `https://github.com/${repository.repo}`, target: "_blank", rel: "noopener noreferrer" },
                        repository.name,
                      ),
                      repository.failing > 0 && h("span", { class: "row-note" }, checksFailing(repository.failing)),
                      repository.stale &&
                        h("span", { class: "row-note" }, `Last checked ${formatTime(repository.checkedAt)}`),
                    ),
                    checks.map(check => h("td", null, cellButton(repository, check))),
                  ),
                ),
            ),
          ),
        ),
      );

      const cards = h(
        "ul",
        { class: "repo-cards", "aria-label": "Repositories" },
        repositories.map(repository => {
          const notable = checks.filter(check =>
            ["fail", "unknown"].includes(repository.cells[check.id]?.status ?? ""),
          );
          return h(
            "li",
            { class: "card", "data-repo": repository.repo },
            h(
              "h2",
              { class: "repo-card-title" },
              repository.name,
              h("span", { class: "muted" }, ` ${productName(repository.product)}`),
            ),
            repository.stale && h("p", { class: "muted" }, `Last checked ${formatTime(repository.checkedAt)}.`),
            notable.length === 0
              ? h("p", { class: "quiet" }, "Every check passes or doesn't apply.")
              : h(
                  "ul",
                  { class: "repo-card-checks" },
                  notable.map(check => {
                    const cell = repository.cells[check.id];
                    return h(
                      "li",
                      { "data-status": cell.status },
                      h("span", { class: "mark", "aria-hidden": "true" }, markOf(cell.status)),
                      h(
                        "span",
                        null,
                        h("strong", null, `${check.title}: ${cellWord(cell.status)}.`),
                        " ",
                        withCode(cell.reason),
                        cell.link && [
                          " ",
                          h("a", { href: cell.link, target: "_blank", rel: "noopener noreferrer" }, "Fix in GitHub"),
                        ],
                      ),
                    );
                  }),
                ),
          );
        }),
      );

      replace(body, statusLine(conformance), table, detail, cards);
      const target = decodeURIComponent(location.hash.slice(1));
      if (target) document.getElementById(target)?.scrollIntoView({ block: "center" });
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
