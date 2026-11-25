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

/** @typedef {{ replyOwed?: number, releasesWaiting?: number, healthFailing?: number }} Waiting */

/** @param {Waiting} waiting */
export function verdict({ replyOwed = 0, releasesWaiting = 0, healthFailing = 0 }) {
  const total = replyOwed + releasesWaiting + healthFailing;
  if (total <= 0) return "All clear.";
  return total === 1 ? "1 thing needs you." : `${total} things need you.`;
}

/** @param {string[]} parts */
const listOf = parts => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/**
 * One sentence per hub: who needs you, then who's quiet. Empty when nothing needs you.
 * @param {{ name: string, needs: number }[]} products
 */
export function hubSummary(products) {
  const busy = products.filter(product => product.needs > 0);
  if (busy.length === 0) return "";
  const quiet = products.filter(product => product.needs === 0);
  const sentences = [`${listOf(busy.map(product => `${product.name} has ${product.needs}`))}.`];
  if (quiet.length)
    sentences.push(`${listOf(quiet.map(product => product.name))} ${quiet.length === 1 ? "is" : "are"} quiet.`);
  return sentences.join(" ");
}

const HEALTH_WORDS = {
  healthy: "Healthy",
  degraded: "Degraded",
  failing: "Failing",
  unmonitored: "Not monitored",
  unknown: "Unknown",
};

/** @param {string} status */
export const healthWord = status => HEALTH_WORDS[/** @type {keyof typeof HEALTH_WORDS} */ (status)] ?? "Unknown";

/** @param {number | null} change */
export function changeText(change) {
  if (change === null) return "";
  if (change === 0) return "Same as last month";
  return change > 0 ? `Up ${change}% on last month` : `Down ${-change}% on last month`;
}

const COUNT = new Intl.NumberFormat("en-GB");

/** @param {number} value */
export const formatCount = value => COUNT.format(value);

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

/**
 * @param {{ version: string, since: string }} beta
 * @param {number} [now]
 */
export const betaText = (beta, now = Date.now()) =>
  `Beta ${beta.version}, ${waitedFor(beta.since, now)} ahead of production`;

const MONITOR_WORDS = {
  up: "Up",
  down: "Down",
  recovering: "Recovering",
  incident: "Open incident",
  paused: "Paused",
  pending: "Waiting for its first check",
  maintenance: "In maintenance",
  missing: "Not in Better Stack",
  unknown: "Unknown",
};

/** @param {string} status */
export const monitorWord = status => MONITOR_WORDS[/** @type {keyof typeof MONITOR_WORDS} */ (status)] ?? "Unknown";

const RELEASE_WORDS = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  spent: "Went out",
};

/** @param {string} state */
export const releaseWord = state => RELEASE_WORDS[/** @type {keyof typeof RELEASE_WORDS} */ (state)] ?? state;
