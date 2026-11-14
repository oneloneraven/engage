const KIND_LABELS = { issue: "Issue report", feedback: "Feedback", email: "Email" };
const SOURCE_LABELS = { web: "Website", app: "App", email: "Email" };
const TIME = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
const DAY = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" });

/** @param {string} kind */
export const kindLabel = kind => KIND_LABELS[/** @type {keyof typeof KIND_LABELS} */ (kind)] ?? kind;

/** @param {string} source */
export const sourceLabel = source => SOURCE_LABELS[/** @type {keyof typeof SOURCE_LABELS} */ (source)] ?? source;

/** @param {string} iso */
export const formatTime = iso => TIME.format(new Date(iso));

/** @param {string} iso */
export const formatDay = iso => DAY.format(new Date(iso));

/** @param {number} bytes */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** @param {number} replyOwed */
export function verdict(replyOwed) {
  if (replyOwed <= 0) return "All green.";
  return replyOwed === 1 ? "1 thing needs you." : `${replyOwed} things need you.`;
}

/**
 * A list row has no message text, so it is named by its subject or, failing that, what it is and who it is from.
 * @param {{ subject: string | null, kind: string, contactName: string | null }} item
 */
export function itemTitle(item) {
  if (item.subject?.trim()) return item.subject.trim();
  return item.contactName ? `${kindLabel(item.kind)} from ${item.contactName}` : kindLabel(item.kind);
}

/**
 * @param {{ subject: string | null, kind: string, contactName: string | null, messages: { direction: string, bodyText: string }[] }} item
 */
export function itemHeading(item) {
  if (item.subject?.trim()) return item.subject.trim();
  const first = item.messages
    .find(message => message.direction === "in")
    ?.bodyText.split("\n")
    .find(line => line.trim())
    ?.trim();
  if (!first) return itemTitle(item);
  const characters = [...first];
  return characters.length > 90 ? `${characters.slice(0, 89).join("")}…` : first;
}
