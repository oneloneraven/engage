// One-off import of feedback from the products' own stores: docs/runbooks/legacy-import.md.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { idFrom } from "../src/lib/ids.js";

const ITEM_COLUMNS = [
  "id",
  "product",
  "kind",
  "source",
  "contact_email",
  "source_page",
  "section",
  "app_version",
  "context",
  "account_ref",
  "read_at",
  "archived_at",
  "created_at",
  "last_activity_at",
];
const MESSAGE_COLUMNS = ["id", "item_id", "direction", "body_text", "created_at"];
const DEAFTLY_KINDS = { bug: "issue", feedback: "feedback" };
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?Z?$/;

/**
 * @typedef {Record<string, string | null>} Row
 * @typedef {{ number: number, body: string, labels: { name: string }[], state: string, createdAt: string, closedAt: string | null }} DeaftlyIssue
 * @typedef {{ id: string, product: string, kind: string, source: string, contact_email: string | null,
 *   source_page: string | null, section: string | null, app_version: string | null, context: string | null,
 *   account_ref: string | null, read_at: string | null, archived_at: string | null, created_at: string,
 *   last_activity_at: string }} Item
 * @typedef {{ id: string, item_id: string, direction: string, body_text: string, created_at: string }} Message
 */

/**
 * CL stores SQLite `datetime('now')`, which is UTC without a zone; GitHub gives ISO 8601 in UTC.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  const match = TIMESTAMP.exec(value);
  const date = match ? new Date(`${match[1]}T${match[2]}${match[3] ?? ""}Z`) : null;
  if (!date || Number.isNaN(date.getTime())) throw new Error(`Unreadable date: ${JSON.stringify(value)}`);
  return date.toISOString();
}

/** @param {string | null | undefined} value */
const iso = value => /** @type {string} */ (isoOrNull(value ?? "missing"));

/**
 * The same source row always gets the same id, and ids keep Engage's order by arrival time.
 * @param {string} createdAt
 * @param {string} key
 */
const legacyId = (createdAt, key) =>
  idFrom(Date.parse(createdAt), new Uint8Array(createHash("sha256").update(`engage-legacy:${key}`).digest()));

/** @param {string | null | undefined} value */
function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (value.includes("\0")) throw new Error("A NUL character can't go into the SQL file");
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * @param {string} table
 * @param {string[]} columns
 * @param {Record<string, string | null>} row
 */
const insert = (table, columns, row) =>
  `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(column => literal(row[column])).join(", ")});\n`;

/**
 * @param {string} product
 * @param {string} kind
 * @param {string} key
 * @param {string} message
 * @param {Omit<Item, "id" | "product" | "kind" | "source" | "last_activity_at">} fields
 * @returns {{ item: Item, message: Message }}
 */
function entry(product, kind, key, message, fields) {
  const id = legacyId(fields.created_at, key);
  return {
    item: { id, product, kind, source: "web", ...fields, last_activity_at: fields.created_at },
    message: {
      id: legacyId(fields.created_at, `${key}:message`),
      item_id: id,
      direction: "in",
      body_text: message,
      created_at: fields.created_at,
    },
  };
}

/**
 * @param {Row} row
 * @param {"issue" | "feedback"} kind
 * @param {string} table
 */
function fromCl(row, kind, table) {
  const context = Object.fromEntries(
    /** @type {[string, string | null | undefined][]} */ ([
      ["reportedUsername", row.reported_username],
      ["reportedEntryId", row.reported_entry_id],
      ["errorRef", row.error_ref],
    ]).filter(([, value]) => value !== null && value !== undefined && value !== ""),
  );
  return entry("cl", kind, `cl:${table}:${row.id}`, String(row.message), {
    contact_email: row.contact_email ?? null,
    source_page: row.source_page ?? null,
    section: row.section ?? null,
    app_version: row.app_version ?? null,
    context: Object.keys(context).length > 0 ? JSON.stringify(context) : null,
    account_ref: row.user_id ?? null,
    read_at: isoOrNull(row.read_at),
    archived_at: isoOrNull(row.archived_at),
    created_at: iso(row.created_at),
  });
}

/**
 * The form's body: a `Kind:` line, an `App version:` line, then the message in a fence longer than any backtick run in it.
 * @param {string} body
 * @returns {{ message: string, appVersion: string | null } | null}
 */
function parseDeaftlyBody(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const open = lines.findIndex(line => /^`{4,}text$/.test(line));
  if (open === -1) return null;
  const fence = lines[open].slice(0, -"text".length);
  const close = lines.indexOf(fence, open + 1);
  const version = /^App version: (.+)$/m.exec(body)?.[1]?.trim();
  if (close === -1 || version === undefined) return null;
  return { message: lines.slice(open + 1, close).join("\n"), appVersion: version === "not given" ? null : version };
}

/**
 * @param {{ clIssueReports: Row[], clFeedback: Row[], deaftlyIssues: DeaftlyIssue[] }} input
 * @returns {{ sql: string, count: number, items: Item[], messages: Message[], skipped: { source: string, reason: string }[] }}
 */
export function transformLegacy({ clIssueReports, clFeedback, deaftlyIssues }) {
  const entries = [
    ...clIssueReports.map(row => fromCl(row, "issue", "issue_reports")),
    ...clFeedback.map(row => fromCl(row, "feedback", "feedback_submissions")),
  ];
  /** @type {{ source: string, reason: string }[]} */
  const skipped = [];
  for (const issue of deaftlyIssues) {
    const source = `deaftly-feedback#${issue.number}`;
    const label = issue.labels.map(({ name }) => name).find(name => Object.hasOwn(DEAFTLY_KINDS, name));
    if (!label) {
      skipped.push({ source, reason: "no bug or feedback label" });
      continue;
    }
    const parsed = parseDeaftlyBody(issue.body ?? "");
    if (!parsed) {
      skipped.push({ source, reason: "not from the feedback form" });
      continue;
    }
    const closedAt = issue.state === "CLOSED" ? iso(issue.closedAt) : null;
    entries.push(
      entry("deaftly", DEAFTLY_KINDS[/** @type {keyof typeof DEAFTLY_KINDS} */ (label)], source, parsed.message, {
        contact_email: null,
        source_page: null,
        section: null,
        app_version: parsed.appVersion,
        context: null,
        account_ref: null,
        read_at: closedAt,
        archived_at: closedAt,
        created_at: iso(issue.createdAt),
      }),
    );
  }

  const items = entries.map(({ item }) => item);
  const messages = entries.map(({ message }) => message);
  const rows = entries
    .map(({ item, message }) => insert("items", ITEM_COLUMNS, item) + insert("messages", MESSAGE_COLUMNS, message))
    .join("");
  const audit =
    "INSERT INTO audit_events (at, actor, action, target_type, target_id, detail) VALUES " +
    `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system:legacy-import', 'items.imported', 'import', 'legacy', ${literal(JSON.stringify({ count: items.length }))});\n`;
  const sql = items.length > 0 ? rows + audit : "";
  return { sql, count: items.length, items, messages, skipped };
}

/**
 * Accepts `wrangler d1 execute --json` output (an array of result sets) or a plain array of rows.
 * @param {unknown} parsed
 * @returns {any[]}
 */
export function rowsOf(parsed) {
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
  const first = parsed[0];
  if (first && typeof first === "object" && Array.isArray(first.results)) return parsed.flatMap(set => set.results);
  return parsed;
}

function main() {
  const { values } = parseArgs({
    options: {
      "cl-issues": { type: "string" },
      "cl-feedback": { type: "string" },
      deaftly: { type: "string" },
      out: { type: "string" },
    },
  });
  const files = [values["cl-issues"], values["cl-feedback"], values.deaftly, values.out];
  if (files.some(file => !file)) {
    console.error("Usage: import-legacy.mjs --cl-issues FILE --cl-feedback FILE --deaftly FILE --out FILE");
    process.exitCode = 2;
    return;
  }
  const read = (/** @type {string} */ file) => rowsOf(JSON.parse(readFileSync(file, "utf8")));
  const result = transformLegacy({
    clIssueReports: read(/** @type {string} */ (values["cl-issues"])),
    clFeedback: read(/** @type {string} */ (values["cl-feedback"])),
    deaftlyIssues: read(/** @type {string} */ (values.deaftly)),
  });
  writeFileSync(/** @type {string} */ (values.out), result.sql, { mode: 0o600 });
  console.error(`Wrote SQL for ${result.count} item${result.count === 1 ? "" : "s"} to ${values.out}.`);
  for (const { source, reason } of result.skipped) console.error(`Skipped ${source}: ${reason}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
