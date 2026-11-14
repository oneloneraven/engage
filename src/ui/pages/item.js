import {
  approveTestimonial,
  createExcerpt,
  createIssue,
  deleteItem,
  getIssueDraft,
  getItem,
  patchItem,
  sendReply,
  withdrawTestimonial,
} from "../api.js";
import { failure, guarded, h, loading, replace } from "../dom.js";
import { formatSize, formatTime, itemHeading, kindLabel, productName, sourceLabel } from "../format.js";

/** @typedef {import("../api.js").ItemDetail} ItemDetail */

const NO_CONTACT = "No contact email";
const NO_CONSENT = "No consent to quote";
const REPLY_MAX = 10_000;

/**
 * @param {string} text
 * @param {() => void} onClick
 * @param {string} [variant]
 */
function button(text, onClick, variant = "secondary") {
  const element = h("button", { type: "button", class: variant }, text);
  element.addEventListener("click", onClick);
  return element;
}

/**
 * @param {string} id
 * @param {string} label
 * @param {HTMLElement} control
 */
const labelled = (id, label, control) => h("div", { class: "field" }, h("label", { for: id }, label), control);

/**
 * @param {Record<string, string>} authResult
 */
const authSentence = authResult => `SPF ${authResult.spf}, DKIM ${authResult.dkim}, DMARC ${authResult.dmarc}`;

/**
 * Mounts one item's header, actions and thread into a pane.
 * @param {HTMLElement} pane
 * @param {string} id
 * @param {{ backHref: string, onChanged: () => void, onGone: () => void }} hooks
 * @returns {{ destroy: () => void }}
 */
export function mountItem(pane, id, hooks) {
  let alive = true;
  /** @type {ItemDetail | null} */
  let item = null;
  let confirmingDelete = false;
  let selectedText = "";
  /** @type {Set<string>} */
  const formattedOpen = new Set();
  /** @type {(() => void) | null} */
  let stopSelection = null;

  replace(pane, loading("Loading the item…"));

  getItem(id)
    .then(loaded => {
      if (!alive) return;
      item = loaded;
      build();
      hooks.onChanged();
    })
    .catch(error => {
      if (alive) replace(pane, failure(error.message));
    });

  function build() {
    const header = h("header", { class: "item-header" });
    const toolbar = h("div", { class: "toolbar", role: "group", "aria-label": "Actions" });
    const actionError = h("div", { class: "status" });
    const banner = h("div", { class: "banner-slot" });
    const panels = h("div", { class: "panels" });
    const details = h("div", { class: "details" });
    const quotes = h("section", { class: "quotes", "aria-labelledby": "quotes-title" });
    const thread = h("ol", { class: "thread", "aria-label": "Messages" });
    const attachments = h("section", { class: "attachments", "aria-labelledby": "attachments-title" });

    const replyPanel = replyComposer(refresh);
    const draftPanel = issueDraftPanel(refresh);
    const quotePanel = quoteComposer(refresh);
    panels.append(replyPanel.root, draftPanel.root, quotePanel.root);

    replace(
      pane,
      h("p", { class: "back" }, h("a", { href: hooks.backHref, "data-link": "" }, "Back to the inbox")),
      header,
      toolbar,
      actionError,
      banner,
      panels,
      thread,
      attachments,
      quotes,
      details,
    );

    document.addEventListener("selectionchange", onSelection);
    stopSelection = () => document.removeEventListener("selectionchange", onSelection);

    function onSelection() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const anchor = selection.anchorNode?.parentElement?.closest(".message.in");
      const focus = selection.focusNode?.parentElement?.closest(".message.in");
      const text = selection.toString().trim();
      if (anchor && anchor === focus && text) selectedText = text;
      else if (selection.isCollapsed && thread.contains(selection.anchorNode)) selectedText = "";
      else return;
      quotePanel.show(selectedText);
    }

    /** @param {string} message */
    const setError = message => replace(actionError, message ? failure(message) : null);

    /**
     * @param {() => Promise<unknown>} work
     */
    async function run(work) {
      setError("");
      try {
        await work();
      } catch (error) {
        setError(/** @type {Error} */ (error).message);
      }
    }

    async function refresh() {
      item = await getItem(id);
      if (!alive) return;
      draw();
      hooks.onChanged();
    }

    /** @param {import("../api.js").ItemDetail} next */
    function adopt(next) {
      item = next;
      draw();
      hooks.onChanged();
    }

    /** @param {HTMLElement} panel @param {HTMLButtonElement} opener */
    function togglePanel(panel, opener) {
      const open = panel.hidden;
      for (const other of [replyPanel.root, draftPanel.root, quotePanel.root]) other.hidden = true;
      panel.hidden = !open;
      for (const other of toolbar.querySelectorAll("button[aria-expanded]"))
        other.setAttribute("aria-expanded", "false");
      opener.setAttribute("aria-expanded", String(open));
      if (open) /** @type {HTMLElement | null} */ (panel.querySelector("textarea, input, button"))?.focus();
    }

    /**
     * A disabled action says why, next to it, in words.
     * @param {HTMLButtonElement} control
     * @param {string | null} reason
     * @param {string} reasonId
     */
    function withReason(control, reason, reasonId) {
      if (!reason) return control;
      control.disabled = true;
      control.setAttribute("aria-describedby", reasonId);
      return h("span", { class: "action" }, control, h("span", { class: "reason", id: reasonId }, reason));
    }

    function drawToolbar() {
      if (!item) return;
      const current = item;
      const reply = h(
        "button",
        { type: "button", class: "primary", "aria-expanded": String(!replyPanel.root.hidden) },
        "Reply",
      );
      reply.addEventListener("click", () => togglePanel(replyPanel.root, reply));
      const issue = current.issueUrl
        ? h(
            "a",
            { class: "button secondary", href: current.issueUrl, target: "_blank", rel: "noopener noreferrer" },
            `View GitHub issue #${current.issueNumber}`,
          )
        : (() => {
            const opener = h(
              "button",
              { type: "button", class: "secondary", "aria-expanded": String(!draftPanel.root.hidden) },
              "Create GitHub issue",
            );
            opener.addEventListener("click", async () => {
              togglePanel(draftPanel.root, opener);
              if (!draftPanel.root.hidden) await draftPanel.open(id);
            });
            return opener;
          })();
      const quote = h(
        "button",
        { type: "button", class: "secondary", "aria-expanded": String(!quotePanel.root.hidden) },
        "Quote",
      );
      quote.addEventListener("click", () => {
        togglePanel(quotePanel.root, quote);
        quotePanel.show(selectedText);
      });
      const star = h("button", { type: "button", class: "secondary", "aria-pressed": String(current.starred) }, "Star");
      guarded(star, () => run(async () => adopt(await patchItem(id, { starred: !current.starred }))));
      const archive = guarded(
        h("button", { type: "button", class: "secondary" }, current.archivedAt ? "Unarchive" : "Archive"),
        () => run(async () => adopt(await patchItem(id, { archived: !current.archivedAt }))),
      );
      const consented = current.kind === "feedback" && current.quoteConsent;
      replace(
        toolbar,
        withReason(reply, current.contactEmail ? null : NO_CONTACT, "reason-reply"),
        issue,
        withReason(quote, consented ? null : NO_CONSENT, "reason-quote"),
        star,
        archive,
        confirmingDelete
          ? deleteConfirmation()
          : h(
              "span",
              { class: "push" },
              button(
                "Delete",
                () => {
                  confirmingDelete = true;
                  drawToolbar();
                  /** @type {HTMLElement | null} */ (toolbar.querySelector("[data-keep]"))?.focus();
                },
                "danger",
              ),
            ),
      );
    }

    function deleteConfirmation() {
      const confirm = guarded(h("button", { type: "button", class: "danger solid" }, "Delete for good"), () =>
        run(async () => {
          await deleteItem(id);
          hooks.onGone();
        }),
      );
      const keep = h("button", { type: "button", class: "secondary", "data-keep": "" }, "Keep it");
      keep.addEventListener("click", () => {
        confirmingDelete = false;
        drawToolbar();
      });
      return h(
        "span",
        { class: "push confirm", role: "group", "aria-label": "Confirm delete" },
        h("span", null, "Delete this and its quotes for good?"),
        confirm,
        keep,
      );
    }

    function drawHeader() {
      if (!item) return;
      const current = item;
      const heading = h("h1", { class: "item-title", tabindex: "-1" }, itemHeading(current));
      replace(
        header,
        heading,
        h(
          "p",
          { class: "muted" },
          `${productName(current.product)} · ${kindLabel(current.kind)} · Received `,
          h("time", { datetime: current.createdAt }, formatTime(current.createdAt)),
        ),
      );
      return heading;
    }

    function drawBanner() {
      if (!item) return;
      const current = item;
      replace(
        banner,
        current.replyOwedAt &&
          h(
            "div",
            { class: "banner" },
            h("span", { class: "dot attention", "aria-hidden": "true" }),
            h("span", { class: "grow" }, "Reply owed: this person is waiting to hear back."),
            guarded(h("button", { type: "button", class: "secondary" }, "Dismiss"), () =>
              run(async () => adopt(await patchItem(id, { replyOwed: false }))),
            ),
          ),
      );
    }

    function drawThread() {
      if (!item) return;
      const current = item;
      replace(
        thread,
        current.messages.map(message =>
          h(
            "li",
            { class: `message ${message.direction}`, "data-direction": message.direction },
            h(
              "p",
              { class: "message-head" },
              h(
                "strong",
                null,
                message.direction === "out" ? "You" : (current.contactName ?? message.fromAddr ?? "Them"),
              ),
              " · ",
              h("time", { datetime: message.createdAt }, formatTime(message.createdAt)),
            ),
            h("p", { class: "message-body" }, message.bodyText),
            message.hasHtml && formattedView(message.id),
          ),
        ),
      );
    }

    /**
     * Inbound HTML loads only on request, as its own sandboxed document from the API.
     * @param {string} messageId
     */
    function formattedView(messageId) {
      const open = formattedOpen.has(messageId);
      const toggle = h(
        "button",
        { type: "button", class: "secondary", "aria-expanded": String(open) },
        open ? "Hide formatted" : "Show formatted",
      );
      toggle.addEventListener("click", () => {
        if (formattedOpen.has(messageId)) formattedOpen.delete(messageId);
        else formattedOpen.add(messageId);
        drawThread();
      });
      return h(
        "div",
        { class: "formatted" },
        toggle,
        open &&
          h(
            "figure",
            null,
            h("iframe", {
              sandbox: true,
              referrerpolicy: "no-referrer",
              title: "Formatted view of this message",
              src: `/api/items/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/html`,
            }),
            h("figcaption", { class: "muted" }, "Formatted view"),
          ),
      );
    }

    function drawAttachments() {
      if (!item) return;
      const current = item;
      replace(
        attachments,
        current.attachments.length > 0 && [
          h("h2", { id: "attachments-title", class: "section-title" }, "Attachments"),
          h(
            "ul",
            { class: "plain" },
            current.attachments.map(attachment =>
              h(
                "li",
                null,
                h(
                  "a",
                  {
                    href: `/api/items/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.id)}`,
                    download: "",
                  },
                  attachment.filename ?? "Attachment",
                ),
                h("span", { class: "muted" }, ` (${formatSize(attachment.size)})`),
              ),
            ),
          ),
        ],
      );
    }

    function drawQuotes() {
      if (!item) return;
      const current = item;
      replace(
        quotes,
        current.testimonials.length > 0 && [
          h("h2", { id: "quotes-title", class: "section-title" }, "Quotes"),
          h(
            "ul",
            { class: "plain" },
            current.testimonials.map(testimonial => {
              const withdrawn = testimonial.withdrawnAt !== null;
              const approved = testimonial.approvedAt !== null && !withdrawn;
              const status = approved ? "Approved" : withdrawn ? "Withdrawn" : "Waiting for approval";
              const action = approved
                ? guarded(h("button", { type: "button", class: "secondary" }, "Withdraw"), () =>
                    run(async () => {
                      await withdrawTestimonial(testimonial.id);
                      await refresh();
                    }),
                  )
                : guarded(
                    h("button", { type: "button", class: "primary" }, withdrawn ? "Approve again" : "Approve"),
                    () =>
                      run(async () => {
                        await approveTestimonial(testimonial.id);
                        await refresh();
                      }),
                  );
              return h(
                "li",
                { class: "quote", "data-status": approved ? "approved" : withdrawn ? "withdrawn" : "waiting" },
                h("blockquote", null, testimonial.excerpt),
                h(
                  "p",
                  { class: "muted" },
                  `${testimonial.attribution} · `,
                  h("strong", { class: "quote-status" }, status),
                ),
                action,
              );
            }),
          ),
        ],
      );
    }

    function drawDetails() {
      if (!item) return;
      const current = item;
      /** @type {[string, string | null][]} */
      const rows = [
        ["Source", sourceLabel(current.source)],
        ["Page or section", current.sourcePage || current.section || null],
        ["App version", current.appVersion],
        ["Contact", [current.contactName, current.contactEmail].filter(Boolean).join(" · ") || null],
        ["Authentication", current.authResult ? authSentence(current.authResult) : null],
        [
          "Quoting",
          current.kind === "feedback"
            ? current.quoteConsent
              ? "They agreed to be quoted"
              : "They didn't agree to be quoted"
            : null,
        ],
      ];
      const shown = rows.filter(([, value]) => value);
      replace(
        details,
        shown.length > 0 && [
          h("h2", { class: "section-title" }, "Details"),
          h(
            "dl",
            { class: "meta" },
            shown.flatMap(([name, value]) => [h("dt", null, name), h("dd", null, value)]),
          ),
        ],
      );
    }

    function draw() {
      const heading = drawHeader();
      drawToolbar();
      drawBanner();
      drawThread();
      drawAttachments();
      drawQuotes();
      drawDetails();
      return heading;
    }

    drawHeader()?.focus();
    draw();
  }

  /** @param {() => Promise<void>} refresh */
  function replyComposer(refresh) {
    const error = h("div", { class: "status" });
    const text = h("textarea", { id: "reply-text", name: "text", rows: "6", maxlength: String(REPLY_MAX) });
    const send = guarded(h("button", { type: "button", class: "primary" }, "Send reply"), async () => {
      replace(error);
      if (!text.value.trim()) {
        replace(error, failure("Write something to send first."));
        return;
      }
      try {
        await sendReply(id, text.value);
        text.value = "";
        root.hidden = true;
        await refresh();
      } catch (caught) {
        replace(error, failure(/** @type {Error} */ (caught).message));
      }
    });
    const root = h(
      "section",
      { class: "panel", hidden: true, "aria-label": "Reply" },
      labelled("reply-text", "Your reply", text),
      h("p", { class: "muted" }, "Plain text, sent to the person's email address."),
      error,
      h(
        "div",
        { class: "buttons" },
        send,
        button("Cancel", () => (root.hidden = true)),
      ),
    );
    return { root };
  }

  /** @param {() => Promise<void>} refresh */
  function issueDraftPanel(refresh) {
    const error = h("div", { class: "status" });
    const repo = h("input", { id: "draft-repo", name: "repo", type: "text", autocomplete: "off" });
    const title = h("input", { id: "draft-title", name: "title", type: "text", maxlength: "256", autocomplete: "off" });
    const body = h("textarea", { id: "draft-body", name: "body", rows: "12" });
    const labels = h("input", { id: "draft-labels", name: "labels", type: "text", autocomplete: "off" });
    const create = guarded(h("button", { type: "button", class: "primary" }, "Create issue"), async () => {
      replace(error);
      try {
        await createIssue(id, {
          repo: repo.value.trim(),
          title: title.value,
          body: body.value,
          labels: labels.value
            .split(",")
            .map(label => label.trim())
            .filter(Boolean),
        });
        root.hidden = true;
        await refresh();
      } catch (caught) {
        replace(error, failure(/** @type {Error} */ (caught).message));
      }
    });
    const form = h(
      "div",
      { class: "form" },
      h(
        "p",
        { class: "muted" },
        "Issues are public. Edit this and remove anything that could identify the person before you create it.",
      ),
      labelled("draft-repo", "Repository", repo),
      labelled("draft-title", "Title", title),
      labelled("draft-body", "Description", body),
      labelled("draft-labels", "Labels, separated by commas", labels),
      error,
      h(
        "div",
        { class: "buttons" },
        create,
        button("Cancel", () => (root.hidden = true)),
      ),
    );
    const root = h(
      "section",
      { class: "panel", hidden: true, "aria-label": "GitHub issue draft" },
      loading("Loading the draft…"),
    );
    let loaded = false;
    return {
      root,
      /** @param {string} itemId */
      async open(itemId) {
        if (loaded) return;
        replace(root, loading("Loading the draft…"));
        try {
          const draft = await getIssueDraft(itemId);
          repo.value = draft.repo;
          title.value = draft.title;
          body.value = draft.body;
          labels.value = draft.labels.join(", ");
          replace(root, form);
          loaded = true;
        } catch (caught) {
          replace(root, failure(/** @type {Error} */ (caught).message));
        }
      },
    };
  }

  /** @param {() => Promise<void>} refresh */
  function quoteComposer(refresh) {
    const error = h("div", { class: "status" });
    const preview = h("blockquote", { class: "preview" });
    const hint = h("p", { class: "muted" }, "Select the words to quote in the message, then save them.");
    const save = guarded(h("button", { type: "button", class: "primary", disabled: true }, "Save quote"), async () => {
      replace(error);
      try {
        await createExcerpt(id, selectedText);
        selectedText = "";
        window.getSelection()?.removeAllRanges();
        root.hidden = true;
        await refresh();
      } catch (caught) {
        replace(error, failure(/** @type {Error} */ (caught).message));
      }
    });
    const root = h(
      "section",
      { class: "panel", hidden: true, "aria-label": "Quote" },
      hint,
      preview,
      error,
      h(
        "div",
        { class: "buttons" },
        save,
        button("Cancel", () => (root.hidden = true)),
      ),
    );
    return {
      root,
      /** @param {string} text */
      show(text) {
        preview.textContent = text;
        preview.hidden = !text;
        save.disabled = !text;
      },
    };
  }

  return {
    destroy() {
      alive = false;
      stopSelection?.();
    },
  };
}
