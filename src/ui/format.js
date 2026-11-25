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

/** @typedef {{ replyOwed: number, releasesWaiting: number }} Waiting */

/** @param {Waiting} waiting */
export function verdict({ replyOwed = 0, releasesWaiting = 0 }) {
  const total = replyOwed + releasesWaiting;
  if (total <= 0) return "All clear.";
  return total === 1 ? "1 thing needs you." : `${total} things need you.`;
}

/** @param {Waiting} waiting */
export function verdictSummary({ replyOwed = 0, releasesWaiting = 0 }) {
  const parts = [
    releasesWaiting === 1
      ? "a release is waiting"
      : releasesWaiting > 1
        ? `${releasesWaiting} releases are waiting`
        : "",
    replyOwed === 1 ? "someone is owed a reply" : replyOwed > 1 ? `${replyOwed} people are owed a reply` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "";
  const sentence = parts.join(" and ");
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}. Everything else is quiet.`;
}

/**
 * How long something has waited, in the largest whole unit.
 * @param {string} iso
 * @param {number} [now]
 */
export function waitedFor(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

const TODAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/London",
});

/** @param {Date} date */
export const formatToday = date => TODAY.format(date);

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
