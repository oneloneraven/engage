import { env as baseEnv } from "cloudflare:test";
import { beforeEach, expect, test, vi } from "vitest";
import { counts, deleteItem, getItem, listItems, setFlags } from "../src/admin/items.js";
import { makeBucket, makeEnv, resetItems } from "./helpers.js";

const ACTOR = "raven@example.com";
const T = (/** @type {number} */ n) => `2026-03-${String(n).padStart(2, "0")}T00:00:00.000Z`;

/**
 * @param {string} id
 * @param {Record<string, unknown>} [fields]
 */
async function seed(id, fields = {}) {
  const row = {
    product: "cl",
    kind: "feedback",
    source: "web",
    subject: null,
    junk: 0,
    starred: 0,
    read_at: null,
    archived_at: null,
    reply_owed_at: null,
    issue_number: null,
    created_at: T(1),
    last_activity_at: T(1),
    ...fields,
  };
  const columns = ["id", ...Object.keys(row)];
  await baseEnv.DB.prepare(`INSERT INTO items (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .bind(id, ...Object.values(row))
    .run();
}

/**
 * @param {string} itemId
 * @param {string} id
 * @param {string} body
 * @param {string} createdAt
 */
async function seedMessage(itemId, id, body, createdAt = T(1)) {
  await baseEnv.DB.prepare(
    "INSERT INTO messages (id, item_id, direction, from_addr, body_text, created_at) VALUES (?, ?, 'in', 'alex@example.org', ?, ?)",
  )
    .bind(id, itemId, body, createdAt)
    .run();
}

async function audits() {
  const { results } = await baseEnv.DB.prepare("SELECT * FROM audit_events ORDER BY id").all();
  return results;
}

/** @param {Record<string, unknown>} filters */
async function ids(filters = {}) {
  const { items } = await listItems(baseEnv, filters);
  return items.map(item => item.id).sort();
}

beforeEach(async () => {
  await resetItems();
  await baseEnv.DB.exec("DELETE FROM testimonials");
  await baseEnv.DB.exec("DELETE FROM audit_events");
});

async function seedStates() {
  await seed("new1", { product: "cl" });
  await seed("new2", { product: "deaftly", kind: "email", source: "email" });
  await seed("open1", { read_at: T(2) });
  await seed("arch1", { read_at: T(2), archived_at: T(3) });
  await seed("arch-unread", { archived_at: T(3) });
  await seed("star1", { starred: 1, read_at: T(2), archived_at: T(3) });
  await seed("star-junk", { starred: 1, junk: 1 });
  await seed("junk1", { junk: 1 });
  await seed("owed1", { read_at: T(2), reply_owed_at: T(4), issue_number: 7 });
}

test("state filters follow the definitions, and junk shows only under junk", async () => {
  await seedStates();
  expect(await ids({ state: "new" })).toEqual(["new1", "new2"]);
  expect(await ids({ state: "open" })).toEqual(["open1", "owed1"]);
  expect(await ids({ state: "archived" })).toEqual(["arch-unread", "arch1", "star1"]);
  expect(await ids({ state: "starred" })).toEqual(["star1"]);
  expect(await ids({ state: "junk" })).toEqual(["junk1", "star-junk"]);
  expect(await ids({ state: "reply-owed" })).toEqual(["owed1"]);
  expect(await ids()).not.toContain("junk1");
  expect(await ids()).toHaveLength(7);
});

test("product, kind and hasIssue filters combine with state", async () => {
  await seedStates();
  expect(await ids({ product: "deaftly" })).toEqual(["new2"]);
  expect(await ids({ kind: "email" })).toEqual(["new2"]);
  expect(await ids({ hasIssue: true })).toEqual(["owed1"]);
  expect(await ids({ hasIssue: false })).toHaveLength(6);
  expect(await ids({ product: "cl", state: "new" })).toEqual(["new1"]);
});

test("q matches the subject and any message body, and escapes LIKE wildcards", async () => {
  await seed("a", { subject: "Grades are wrong" });
  await seed("b", { subject: "Hello" });
  await seed("c", { subject: "100% sure" });
  await seed("d", { subject: "snake_case" });
  await seedMessage("b", "m1", "first");
  await seedMessage("b", "m2", "the Grades page crashes");
  expect(await ids({ q: "grades" })).toEqual(["a", "b"]);
  expect(await ids({ q: "100%" })).toEqual(["c"]);
  expect(await ids({ q: "%" })).toEqual(["c"]);
  expect(await ids({ q: "_" })).toEqual(["d"]);
  expect(await ids({ q: "snake_c" })).toEqual(["d"]);
  expect(await ids({ q: "nothing" })).toEqual([]);
});

test("a summary carries the inbox fields and a message count", async () => {
  await seed("a", { subject: "Hi", contact_email: "alex@example.org", starred: 1, issue_number: 3, issue_url: "u" });
  await seedMessage("a", "m1", "one");
  await seedMessage("a", "m2", "two");
  const { items } = await listItems(baseEnv, {});
  expect(items[0]).toMatchObject({
    id: "a",
    product: "cl",
    kind: "feedback",
    source: "web",
    subject: "Hi",
    contactEmail: "alex@example.org",
    starred: true,
    junk: false,
    readAt: null,
    archivedAt: null,
    replyOwedAt: null,
    issueNumber: 3,
    issueUrl: "u",
    messageCount: 2,
    createdAt: T(1),
    lastActivityAt: T(1),
  });
});

test("cursor pagination returns every item exactly once, newest first", async () => {
  for (let n = 0; n < 7; n++) await seed(`i${n}`, { last_activity_at: T(1 + (n % 3)) });
  const seen = [];
  /** @type {string | null | undefined} */
  let cursor;
  let pages = 0;
  do {
    const page = await listItems(baseEnv, { limit: 3, cursor: cursor ?? undefined });
    seen.push(...page.items);
    cursor = page.next;
    pages++;
  } while (cursor);
  expect(pages).toBe(3);
  expect(seen.map(item => item.id).sort()).toEqual(["i0", "i1", "i2", "i3", "i4", "i5", "i6"]);
  const keys = seen.map(item => `${item.lastActivityAt}|${item.id}`);
  expect(keys).toEqual([...keys].sort().reverse());
});

test("next is null when the page is the last", async () => {
  await seed("a");
  await seed("b");
  expect((await listItems(baseEnv, { limit: 2 })).next).toBeNull();
  expect((await listItems(baseEnv, { limit: 1 })).next).toEqual(expect.any(String));
});

test("limit defaults to 50 and is capped at 200", async () => {
  const statements = [];
  for (let n = 0; n < 205; n++) {
    statements.push(
      baseEnv.DB.prepare(
        "INSERT INTO items (id, product, kind, source, created_at, last_activity_at) VALUES (?, 'cl', 'feedback', 'web', ?, ?)",
      ).bind(`b${String(n).padStart(3, "0")}`, T(1), T(1)),
    );
  }
  await baseEnv.DB.batch(statements);
  expect((await listItems(baseEnv, {})).items).toHaveLength(50);
  expect((await listItems(baseEnv, { limit: 1000 })).items).toHaveLength(200);
  expect((await listItems(baseEnv, { limit: 0 })).items).toHaveLength(50);
});

test("a bad cursor throws bad-cursor", async () => {
  for (const cursor of ["!!!", btoa("nope"), btoa(JSON.stringify([1, 2])), btoa(JSON.stringify({}))]) {
    await expect(listItems(baseEnv, { cursor })).rejects.toThrow("bad-cursor");
  }
});

test("junk never counts as owing a reply, so the badge matches the list", async () => {
  await baseEnv.DB.prepare(
    "INSERT INTO items (id, product, kind, source, junk, reply_owed_at, created_at, last_activity_at) VALUES ('j', 'cl', 'email', 'email', 1, ?, ?, ?)",
  )
    .bind(T(1), T(1), T(1))
    .run();
  expect((await counts(baseEnv)).replyOwed).toBe(0);
  expect((await listItems(baseEnv, { state: "reply-owed" })).items).toHaveLength(0);
});

test("counts use the plan definitions and list every product, zeros included", async () => {
  await seedStates();
  expect(await counts(baseEnv)).toEqual({
    new: 2,
    open: 2,
    replyOwed: 1,
    byProduct: { cl: { new: 1, open: 2 }, deaftly: { new: 1, open: 0 } },
  });
  await resetItems();
  expect(await counts(baseEnv)).toEqual({
    new: 0,
    open: 0,
    replyOwed: 0,
    byProduct: { cl: { new: 0, open: 0 }, deaftly: { new: 0, open: 0 } },
  });
});

test("getItem returns the thread in order, attachment metadata and testimonials", async () => {
  await seed("a", {
    subject: "Hi",
    context: JSON.stringify({ errorRef: "e1" }),
    auth_result: JSON.stringify({ spf: "pass", dkim: "pass", dmarc: "none" }),
    account_ref: "acct",
    source_page: "/x",
    app_version: "1.2",
  });
  await seedMessage("a", "m2", "second", T(2));
  await seedMessage("a", "m1", "first", T(2));
  await seedMessage("a", "m0", "zeroth", T(1));
  await baseEnv.DB.prepare(
    "INSERT INTO attachments (id, item_id, message_id, r2_key, filename, content_type, size) VALUES ('att1', 'a', 'm0', 'items/a/att1', 'pic.png', 'image/png', 12)",
  ).run();
  await baseEnv.DB.prepare(
    "INSERT INTO testimonials (id, item_id, product, excerpt, attribution, created_at) VALUES ('t1', 'a', 'cl', 'Great', 'Alex', ?)",
  )
    .bind(T(3))
    .run();
  const item = await getItem(baseEnv, "a");
  expect(item).toMatchObject({
    id: "a",
    subject: "Hi",
    context: { errorRef: "e1" },
    authResult: { spf: "pass", dkim: "pass", dmarc: "none" },
    accountRef: "acct",
    sourcePage: "/x",
    appVersion: "1.2",
    readAt: null,
  });
  expect(item?.messages.map(message => message.id)).toEqual(["m0", "m1", "m2"]);
  expect(item?.messages[0]).toMatchObject({ direction: "in", fromAddr: "alex@example.org", bodyText: "zeroth" });
  expect(item?.attachments).toEqual([
    { id: "att1", messageId: "m0", filename: "pic.png", contentType: "image/png", size: 12 },
  ]);
  expect(item?.testimonials).toEqual([
    {
      id: "t1",
      product: "cl",
      excerpt: "Great",
      attribution: "Alex",
      approvedAt: null,
      withdrawnAt: null,
      createdAt: T(3),
    },
  ]);
});

test("getItem returns null contexts as null, does not mark read, and null for an unknown id", async () => {
  await seed("a");
  const item = await getItem(baseEnv, "a");
  expect(item?.context).toBeNull();
  expect(item?.authResult).toBeNull();
  expect(item?.readAt).toBeNull();
  expect(await getItem(baseEnv, "missing")).toBeNull();
  expect(await audits()).toEqual([]);
});

/** @param {string} id */
const row = id => baseEnv.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first();

test("setFlags sets and clears each flag and writes one audit row per change", async () => {
  await seed("a", { reply_owed_at: T(2) });
  await setFlags(baseEnv, "a", { read: true, starred: true, archived: true, junk: true, replyOwed: false }, ACTOR);
  const set = await row("a");
  expect(set?.read_at).toEqual(expect.any(String));
  expect(new Date(String(set?.read_at)).toISOString()).toBe(set?.read_at);
  expect(set?.archived_at).toEqual(expect.any(String));
  expect(set).toMatchObject({ starred: 1, junk: 1, reply_owed_at: null });
  expect((await audits()).map(event => event.action).sort()).toEqual([
    "item.archived",
    "item.junk",
    "item.read",
    "item.reply-owed-dismissed",
    "item.starred",
  ]);

  await setFlags(baseEnv, "a", { read: false, starred: false, archived: false, junk: false }, ACTOR);
  expect(await row("a")).toMatchObject({ read_at: null, archived_at: null, starred: 0, junk: 0 });
  expect(
    (await audits())
      .slice(5)
      .map(event => event.action)
      .sort(),
  ).toEqual(["item.not-junk", "item.unarchived", "item.unread", "item.unstarred"]);
});

test("audit rows are attributed to the actor, target the item and carry an empty detail", async () => {
  await seed("a");
  await setFlags(baseEnv, "a", { starred: true }, ACTOR);
  expect((await audits())[0]).toMatchObject({
    actor: ACTOR,
    action: "item.starred",
    target_type: "item",
    target_id: "a",
    detail: "{}",
  });
});

test("a flag already in the requested state writes nothing and keeps its timestamp", async () => {
  await seed("a", { read_at: T(2), starred: 1 });
  await setFlags(baseEnv, "a", { read: true, starred: true, archived: false, junk: false, replyOwed: false }, ACTOR);
  expect(await audits()).toEqual([]);
  expect((await row("a"))?.read_at).toBe(T(2));
});

test("replyOwed true is rejected and nothing else in the change is applied", async () => {
  await seed("a");
  await expect(setFlags(baseEnv, "a", { starred: true, replyOwed: /** @type {any} */ (true) }, ACTOR)).rejects.toThrow(
    "reply-owed-not-settable",
  );
  expect((await row("a"))?.starred).toBe(0);
  expect(await audits()).toEqual([]);
});

test("setFlags on an unknown item throws not-found", async () => {
  await expect(setFlags(baseEnv, "missing", { read: true }, ACTOR)).rejects.toThrow("not-found");
  expect(await audits()).toEqual([]);
});

async function seedFull() {
  await seed("a", { subject: "secret subject" });
  await seed("keep");
  await seedMessage("a", "m1", "private words");
  await seedMessage("keep", "m2", "other");
  await baseEnv.DB.prepare(
    "INSERT INTO attachments (id, item_id, message_id, r2_key, filename, content_type, size) VALUES ('att1', 'a', 'm1', 'items/a/att1', 'p.png', 'image/png', 1), ('att2', 'a', 'm1', 'items/a/att2', 'q.png', 'image/png', 1), ('att3', 'keep', 'm2', 'items/keep/att3', 'r.png', 'image/png', 1)",
  ).run();
  await baseEnv.DB.prepare(
    "INSERT INTO testimonials (id, item_id, product, excerpt, attribution, created_at) VALUES ('t1', 'a', 'cl', 'x', 'y', ?)",
  )
    .bind(T(1))
    .run();
}

/** @param {string[]} keys */
function bucketWith(keys) {
  const bucket = makeBucket();
  for (const key of keys) bucket.objects.set(key, { value: new ArrayBuffer(1), options: {} });
  return bucket;
}

test("deleteItem removes the item, its rows and its R2 objects, and audits only the id", async () => {
  await seedFull();
  const bucket = bucketWith(["items/a/att1", "items/a/att2", "items/keep/att3"]);
  const env = makeEnv({ ATTACHMENTS: bucket });
  await deleteItem(env, "a", ACTOR);
  expect(await getItem(env, "a")).toBeNull();
  for (const table of ["messages", "attachments", "testimonials"]) {
    const { results } = await baseEnv.DB.prepare(`SELECT * FROM ${table} WHERE item_id = 'a'`).all();
    expect(results).toEqual([]);
  }
  expect([...bucket.objects.keys()]).toEqual(["items/keep/att3"]);
  expect(await getItem(env, "keep")).not.toBeNull();
  const events = await audits();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    actor: ACTOR,
    action: "item.deleted",
    target_type: "item",
    target_id: "a",
    detail: "{}",
  });
  expect(JSON.stringify(events)).not.toContain("secret subject");
});

test("deleteItem leaves the rows in place when an R2 delete fails, so it can be retried", async () => {
  await seedFull();
  const bucket = bucketWith(["items/a/att1", "items/a/att2"]);
  const env = makeEnv({
    ATTACHMENTS: {
      delete: async (/** @type {string} */ key) => {
        if (key === "items/a/att2") throw new Error("r2 down");
        await bucket.delete(key);
      },
    },
  });
  await expect(deleteItem(env, "a", ACTOR)).rejects.toThrow("r2 down");
  expect(await getItem(env, "a")).not.toBeNull();
  expect(await audits()).toEqual([]);
  await deleteItem(makeEnv({ ATTACHMENTS: bucket }), "a", ACTOR);
  expect(await getItem(env, "a")).toBeNull();
  expect(bucket.objects.size).toBe(0);
});

test("deleteItem calls beforeDelete first with the env, id and actor, and stops if it throws", async () => {
  await seedFull();
  const bucket = bucketWith(["items/a/att1", "items/a/att2"]);
  const env = makeEnv({ ATTACHMENTS: bucket });
  const order = /** @type {string[]} */ ([]);
  const original = bucket.delete;
  bucket.delete = async keys => {
    order.push("r2");
    return original(keys);
  };
  const beforeDelete = vi.fn(async () => {
    order.push("hook");
  });
  await deleteItem(env, "a", ACTOR, { beforeDelete });
  expect(beforeDelete).toHaveBeenCalledWith(env, "a", ACTOR);
  expect(order[0]).toBe("hook");

  await seed("b");
  const failing = vi.fn(async () => {
    throw new Error("hook failed");
  });
  await expect(deleteItem(env, "b", ACTOR, { beforeDelete: failing })).rejects.toThrow("hook failed");
  expect(await getItem(env, "b")).not.toBeNull();
});

test("deleteItem on an unknown item throws not-found without calling the hook", async () => {
  const beforeDelete = vi.fn();
  await expect(deleteItem(makeEnv({ ATTACHMENTS: makeBucket() }), "missing", ACTOR, { beforeDelete })).rejects.toThrow(
    "not-found",
  );
  expect(beforeDelete).not.toHaveBeenCalled();
});
