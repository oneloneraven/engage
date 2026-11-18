import { longestBacktickRun } from "../lib/text.js";

const TITLE_MAX = 70;
const LABELS = { issue: ["bug"], feedback: ["enhancement"], email: [] };

/**
 * An editable draft for a public issue. It never carries the contact email, name, account reference or context.
 * @param {{ kind: "issue" | "feedback" | "email", subject?: string | null, appVersion?: string | null, sourcePage?: string | null, section?: string | null, messages: { direction: string, bodyText: string }[] }} item
 * @param {{ issueRepo: string }} product
 * @returns {import("./app.js").IssueDraft}
 */
export function issueDraft(item, product) {
  const message = item.messages.find(entry => entry.direction === "in")?.bodyText ?? "";
  const firstLine =
    (item.subject ?? message)
      .split("\n")
      .find(line => line.trim())
      ?.trim() ?? "Feedback";
  const chars = [...firstLine];
  const title = chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX - 1).join("")}…` : firstLine;
  const fence = "`".repeat(Math.max(4, longestBacktickRun(message) + 1));
  const body = [
    `${fence}text`,
    message,
    fence,
    "",
    `App version: ${item.appVersion || "not given"}`,
    `Page or section: ${item.sourcePage || item.section || "not given"}`,
  ].join("\n");
  return { repo: product.issueRepo, title, body, labels: LABELS[item.kind] ?? [] };
}
