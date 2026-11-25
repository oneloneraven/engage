import { decideRelease, getRelease, listReleases } from "../api.js";
import { emptyState, failure, guarded, h, link, loading, replace } from "../dom.js";
import { formatTime, waitedFor } from "../format.js";

const NOTE_MAX = 1000;
const CHECKS = {
  success: "Checks passed",
  failure: "Checks failed",
  pending: "Checks still running",
  unknown: "Checks unknown",
};

/** @param {import("../api.js").Release} release */
const releaseTitle = release =>
  `${release.productName} ${release.ref ?? release.sha.slice(0, 7)} to ${release.environment}`;

/**
 * @param {HTMLElement} container
 * @param {import("../router.js").RouteContext} context
 * @returns {import("../router.js").Page}
 */
export function releasesPage(container, context) {
  document.title = "Releases – Engage";
  let releaseId = context.params[0] ?? null;
  let alive = true;
  const list = h("ul", { class: "rows" });
  const listStatus = h("div", { class: "status" });
  const detail = h("section", { class: "detail-pane", "aria-label": "Release" });
  const split = h(
    "div",
    { class: "split" },
    h(
      "section",
      { class: "list-pane", "aria-label": "Releases waiting" },
      h("h1", { class: "page-title" }, "Releases"),
      listStatus,
      list,
    ),
    detail,
  );
  container.append(split);

  async function loadList() {
    try {
      const { releases } = await listReleases({ state: "pending" });
      if (!alive) return;
      replace(
        list,
        releases.map(release =>
          h(
            "li",
            { "data-id": release.id },
            h(
              "a",
              {
                class: "row-link",
                href: `/releases/${encodeURIComponent(release.id)}`,
                "data-link": "",
                ...(release.id === releaseId && { "aria-current": "true" }),
              },
              h(
                "span",
                { class: "row-body" },
                h(
                  "span",
                  { class: "row-top" },
                  h("span", { class: "row-title" }, releaseTitle(release)),
                  h("span", { class: "row-time" }, waitedFor(release.createdAt)),
                ),
                h("span", { class: "row-tags" }, h("span", { class: "row-product" }, release.repo)),
              ),
            ),
          ),
        ),
      );
      replace(listStatus, releases.length === 0 && emptyState("Nothing is waiting to go out."));
    } catch (error) {
      if (alive) replace(listStatus, failure(/** @type {Error} */ (error).message));
    }
  }

  async function drawDetail() {
    split.classList.toggle("has-item", releaseId !== null);
    if (releaseId === null) {
      replace(detail, h("div", { class: "empty-pane" }, emptyState("Pick a release from the list to review it.")));
      return;
    }
    const id = releaseId;
    replace(detail, loading("Loading the release…"));
    try {
      const { release, pulls, checks } = await getRelease(id);
      if (!alive || id !== releaseId) return;
      const heading = h("h2", { class: "item-title", tabindex: "-1" }, releaseTitle(release));
      const status = h("div", { class: "status" });
      replace(
        detail,
        h("p", { class: "back" }, link("/releases", "Back to releases")),
        h(
          "header",
          { class: "item-header" },
          h(
            "ul",
            { class: "item-chips", "aria-label": "About this release" },
            h("li", null, release.repo),
            h("li", null, `Commit ${release.sha.slice(0, 7)}`),
            h("li", { class: `checks ${checks.conclusion}` }, CHECKS[checks.conclusion]),
          ),
          heading,
          h(
            "p",
            { class: "muted" },
            "Asked ",
            h("time", { datetime: release.createdAt }, formatTime(release.createdAt)),
            checks.url && [
              ". ",
              h("a", { href: checks.url, rel: "noopener noreferrer", target: "_blank" }, "Open the run on GitHub"),
            ],
          ),
        ),
        h(
          "section",
          { "aria-labelledby": "pulls-title" },
          h("h3", { id: "pulls-title", class: "section-title" }, "What's going out"),
          pulls.length === 0
            ? h("p", { class: "muted" }, "No pull requests found since the last release to this environment.")
            : h(
                "ul",
                { class: "pulls" },
                pulls.map(pull =>
                  h(
                    "li",
                    null,
                    h("a", { href: pull.url, rel: "noopener noreferrer", target: "_blank" }, `#${pull.number}`),
                    ` ${pull.title}`,
                  ),
                ),
              ),
        ),
        release.state === "pending"
          ? decisionPanel(release, status)
          : h("p", { class: "muted" }, `This release was ${release.state}.`),
        status,
      );
      heading.focus();
    } catch (error) {
      if (alive && id === releaseId) replace(detail, failure(/** @type {Error} */ (error).message));
    }
  }

  /**
   * @param {import("../api.js").Release} release
   * @param {HTMLElement} status
   */
  function decisionPanel(release, status) {
    const note = h("textarea", { id: "release-note", name: "note", rows: "3", maxlength: String(NOTE_MAX) });
    const actions = h("div", { class: "buttons" });
    /** @param {"approve" | "reject"} decision */
    const decide = decision => async () => {
      replace(status);
      try {
        await decideRelease(release.id, decision, note.value.trim());
        await Promise.all([loadList(), drawDetail()]);
      } catch (error) {
        replace(status, failure(/** @type {Error} */ (error).message));
      }
    };
    const approve = guarded(h("button", { type: "button", class: "attention" }, "Approve release"), decide("approve"));
    const reject = h("button", { type: "button", class: "danger" }, "Reject");
    reject.addEventListener("click", () => {
      const confirm = guarded(
        h("button", { type: "button", class: "danger solid" }, "Reject release"),
        decide("reject"),
      );
      const keep = h("button", { type: "button" }, "Keep it waiting");
      keep.addEventListener("click", () => {
        replace(actions, approve, reject);
        reject.focus();
      });
      replace(actions, h("span", { class: "confirm" }, h("span", null, "Reject this release?"), confirm, keep));
      confirm.focus();
    });
    replace(actions, approve, reject);
    return h(
      "section",
      { class: "panel", "aria-label": "Decide" },
      h("div", { class: "field" }, h("label", { for: "release-note" }, "Note (optional, sent to GitHub)"), note),
      actions,
    );
  }

  loadList();
  drawDetail();

  return {
    update(next) {
      const nextId = next.params[0] ?? null;
      if (nextId === releaseId) return;
      releaseId = nextId;
      for (const li of list.children) {
        const a = li.querySelector("a");
        if (li.getAttribute("data-id") === releaseId) a?.setAttribute("aria-current", "true");
        else a?.removeAttribute("aria-current");
      }
      drawDetail();
    },
    destroy() {
      alive = false;
    },
  };
}
