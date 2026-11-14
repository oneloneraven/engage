import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { rowsOf, transformLegacy } from "../../scripts/import-legacy.mjs";

const clIssue = {
  id: "cl-issue-1",
  message: "The map won't load",
  contact_email: "climber@example.test",
  user_id: "user-1",
  source_page: "https://climbinglogbook.com/log",
  section: "logbook",
  app_version: "1.2.3",
  reported_username: "someone",
  reported_entry_id: "entry-9",
  error_ref: "err-abc",
  read_at: "2026-03-02 09:00:00",
  archived_at: "2026-03-03 10:00:00",
  created_at: "2026-03-01 08:30:15",
};

const clFeedback = {
  id: "cl-feedback-1",
  message: "Love it, but it's slow",
  contact_email: null,
  user_id: null,
  source_page: null,
  section: null,
  app_version: null,
  read_at: null,
  archived_at: null,
  created_at: "2026-04-01 12:00:00",
};

/** @param {string} message */
const deaftlyBody = (message, fence = "````") =>
  [
    "Kind: Bug",
    "App version: 0.41.1",
    "",
    `${fence}text`,
    message,
    fence,
    "",
    "Sent from the deaftly.com feedback form.",
  ].join("\n");

const deaftlyBug = {
  number: 7,
  title: "Bug: Captions lag",
  body: deaftlyBody("Captions lag\n```\nby a second\n```", "````"),
  labels: [{ name: "bug" }],
  state: "CLOSED",
  createdAt: "2026-05-01T10:00:00Z",
  closedAt: "2026-05-04T11:00:00Z",
};

const deaftlyFeedback = {
  number: 8,
  title: "Feedback: More languages",
  body: deaftlyBody("More languages please").replace("App version: 0.41.1", "App version: not given"),
  labels: [{ name: "feedback" }],
  state: "OPEN",
  createdAt: "2026-06-01T10:00:00Z",
  closedAt: null,
};

const empty = { clIssueReports: [], clFeedback: [], deaftlyIssues: [] };

/** @param {string} sql */
const statements = sql => sql.split(";\n").filter(Boolean);

test("CL issue reports become web issues, keeping state, dates, context and the account reference", () => {
  const { items, messages } = transformLegacy({ ...empty, clIssueReports: [clIssue] });
  expect(items).toEqual([
    {
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      product: "cl",
      kind: "issue",
      source: "web",
      contact_email: "climber@example.test",
      source_page: "https://climbinglogbook.com/log",
      section: "logbook",
      app_version: "1.2.3",
      context: JSON.stringify({ reportedUsername: "someone", reportedEntryId: "entry-9", errorRef: "err-abc" }),
      account_ref: "user-1",
      read_at: "2026-03-02T09:00:00.000Z",
      archived_at: "2026-03-03T10:00:00.000Z",
      created_at: "2026-03-01T08:30:15.000Z",
      last_activity_at: "2026-03-01T08:30:15.000Z",
    },
  ]);
  expect(messages).toEqual([
    {
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      item_id: items[0].id,
      direction: "in",
      body_text: "The map won't load",
      created_at: "2026-03-01T08:30:15.000Z",
    },
  ]);
});

test("CL feedback becomes web feedback with no consent to quote, and empty fields stay empty", () => {
  const { items, messages } = transformLegacy({ ...empty, clFeedback: [clFeedback] });
  expect(items[0]).toMatchObject({
    product: "cl",
    kind: "feedback",
    source: "web",
    contact_email: null,
    context: null,
    account_ref: null,
    read_at: null,
    archived_at: null,
    created_at: "2026-04-01T12:00:00.000Z",
  });
  expect(items[0]).not.toHaveProperty("quote_consent");
  expect(messages[0].body_text).toBe("Love it, but it's slow");
});

test("Deaftly issues map their label to a kind, take the message from the fence and the version from its line", () => {
  const { items, messages } = transformLegacy({ ...empty, deaftlyIssues: [deaftlyBug, deaftlyFeedback] });
  expect(items.map(item => [item.product, item.kind, item.source, item.app_version])).toEqual([
    ["deaftly", "issue", "web", "0.41.1"],
    ["deaftly", "feedback", "web", null],
  ]);
  expect(messages.map(message => message.body_text)).toEqual([
    "Captions lag\n```\nby a second\n```",
    "More languages please",
  ]);
});

test("a closed Deaftly issue arrives read and archived when it closed; an open one arrives unread", () => {
  const { items } = transformLegacy({ ...empty, deaftlyIssues: [deaftlyBug, deaftlyFeedback] });
  expect(items[0]).toMatchObject({
    created_at: "2026-05-01T10:00:00.000Z",
    read_at: "2026-05-04T11:00:00.000Z",
    archived_at: "2026-05-04T11:00:00.000Z",
  });
  expect(items[1]).toMatchObject({ read_at: null, archived_at: null });
});

test("Deaftly issues not sent by the form are skipped and counted", () => {
  const manual = { ...deaftlyFeedback, number: 9, body: "Raised by hand" };
  const unlabelled = { ...deaftlyFeedback, number: 10, labels: [{ name: "question" }] };
  const result = transformLegacy({ ...empty, deaftlyIssues: [manual, unlabelled, deaftlyBug] });
  expect(result.count).toBe(1);
  expect(result.skipped).toEqual([
    { source: "deaftly-feedback#9", reason: "not from the feedback form" },
    { source: "deaftly-feedback#10", reason: "no bug or feedback label" },
  ]);
});

test("ids are deterministic, distinct per source row, and sort by when the item arrived", () => {
  const input = { clIssueReports: [clIssue], clFeedback: [clFeedback], deaftlyIssues: [deaftlyBug] };
  const first = transformLegacy(input);
  expect(transformLegacy(input).sql).toBe(first.sql);
  const ids = [...first.items.map(item => item.id), ...first.messages.map(message => message.id)];
  expect(new Set(ids).size).toBe(ids.length);
  expect(first.items.map(item => item.id).sort()).toEqual(first.items.map(item => item.id));
  const sameIdOtherTable = transformLegacy({ ...empty, clFeedback: [{ ...clFeedback, id: clIssue.id }] });
  expect(sameIdOtherTable.items[0].id).not.toBe(transformLegacy({ ...empty, clIssueReports: [clIssue] }).items[0].id);
});

test("the SQL inserts each row once, ignores rows already imported, and escapes quotes by doubling", () => {
  const { sql, count } = transformLegacy({ ...empty, clIssueReports: [clIssue], clFeedback: [clFeedback] });
  expect(count).toBe(2);
  const lines = statements(sql);
  expect(lines).toHaveLength(5);
  for (const line of lines.slice(0, 4)) expect(line).toMatch(/^INSERT OR IGNORE INTO (items|messages) \(/);
  expect(sql).toContain("'The map won''t load'");
  expect(sql).toContain("'Love it, but it''s slow'");
  expect(sql).not.toContain("?");
});

test("the SQL leaves no way out of a string literal", () => {
  const sneaky = { ...clFeedback, id: "x", message: "'); DROP TABLE items; --" };
  const { sql } = transformLegacy({ ...empty, clFeedback: [sneaky] });
  expect(sql).toContain("'''); DROP TABLE items; --'");
});

test("a NUL character or an unreadable date stops the import rather than altering the data", () => {
  expect(() => transformLegacy({ ...empty, clFeedback: [{ ...clFeedback, message: "a\0b" }] })).toThrow(/NUL/);
  expect(() => transformLegacy({ ...empty, clFeedback: [{ ...clFeedback, created_at: "yesterday" }] })).toThrow(/date/);
});

test("the SQL loads into Engage's schema, and running it again adds nothing", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync("migrations").sort()) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  const { sql } = transformLegacy({ clIssueReports: [clIssue], clFeedback: [clFeedback], deaftlyIssues: [deaftlyBug] });
  db.exec(sql);
  db.exec(sql);
  expect(db.prepare("SELECT product, kind, quote_consent FROM items ORDER BY id").all()).toEqual([
    { product: "cl", kind: "issue", quote_consent: 0 },
    { product: "cl", kind: "feedback", quote_consent: 0 },
    { product: "deaftly", kind: "issue", quote_consent: 0 },
  ]);
  expect(db.prepare("SELECT body_text FROM messages WHERE body_text LIKE '%won''t%'").get()).toEqual({
    body_text: "The map won't load",
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 3 });
  const audit = db.prepare("SELECT at, actor, action, target_type, target_id, detail FROM audit_events").all();
  expect(audit).toHaveLength(2);
  expect(audit[0]).toEqual({
    at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    actor: "system:legacy-import",
    action: "items.imported",
    target_type: "import",
    target_id: "legacy",
    detail: '{"count":3}',
  });
});

test("nothing to import writes no SQL, not even an audit entry", () => {
  expect(transformLegacy(empty)).toMatchObject({ sql: "", count: 0 });
});

test("rows are read from wrangler's --json output or from a plain array", () => {
  expect(rowsOf([{ results: [{ id: "a" }], success: true, meta: {} }])).toEqual([{ id: "a" }]);
  expect(rowsOf([{ number: 1 }])).toEqual([{ number: 1 }]);
  expect(() => rowsOf({ nope: true })).toThrow();
});
