import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runRetention, subtractMonths } from "../src/retention.js";
import worker from "../src/worker.js";
import { makeBucket, makeCtx, makeEnv, resetItems } from "./helpers.js";

const NOW = new Date("2026-11-13T03:17:00.000Z");
const DAY = 86_400_000;
const iso = (/** @type {string} */ date) => new Date(date).toISOString();
const daysAgo = (/** @type {number} */ days) => new Date(NOW.getTime() - days * DAY).toISOString();

beforeEach(async () => {
  await resetItems();
  await baseEnv.DB.exec("DELETE FROM audit_events");
  await baseEnv.DB.exec("UPDATE products SET retention_months = 12");
});
afterEach(() => vi.restoreAllMocks());

const testEnv = () => makeEnv({ ATTACHMENTS: makeBucket() });

/**
 * @param {string} id
 * @param {{ product?: string, junk?: number, archivedAt?: string | null, createdAt?: string, lastActivityAt?: string }} [fields]
 */
async function seed(id, { product = "cl", junk = 0, archivedAt = null, createdAt, lastActivityAt } = {}) {
  await baseEnv.DB.prepare(
    "INSERT INTO items (id, product, kind, source, junk, archived_at, created_at, last_activity_at) VALUES (?, ?, 'feedback', 'web', ?, ?, ?, ?)",
  )
    .bind(
      id,
      product,
      junk,
      archivedAt,
      createdAt ?? lastActivityAt ?? daysAgo(1),
      lastActivityAt ?? createdAt ?? daysAgo(1),
    )
    .run();
}

async function remaining() {
  const { results } = await baseEnv.DB.prepare("SELECT id FROM items ORDER BY id").all();
  return results.map(row => String(row.id));
}

test("archived items are deleted once archived_at is more than the product's months ago", async () => {
  await seed("old", { archivedAt: iso("2025-11-12T03:17:00.000Z"), lastActivityAt: daysAgo(1) });
  await seed("recent", { archivedAt: iso("2025-11-14T03:17:00.000Z"), lastActivityAt: daysAgo(1) });
  expect(await runRetention(testEnv(), NOW)).toEqual({ deleted: 1, failed: 0 });
  expect(await remaining()).toEqual(["recent"]);
});

test("an item due exactly at the cutoff is kept", async () => {
  await seed("exact", { archivedAt: iso("2025-11-13T03:17:00.000Z"), lastActivityAt: daysAgo(1) });
  expect(await runRetention(testEnv(), NOW)).toEqual({ deleted: 0, failed: 0 });
});

test("unarchived items go by last_activity_at, not created_at", async () => {
  await seed("stale", { createdAt: daysAgo(900), lastActivityAt: iso("2025-11-12T03:17:00.000Z") });
  await seed("active", { createdAt: daysAgo(900), lastActivityAt: iso("2025-11-14T03:17:00.000Z") });
  await runRetention(testEnv(), NOW);
  expect(await remaining()).toEqual(["active"]);
});

test("an archived item ignores its last activity", async () => {
  await seed("a", {
    archivedAt: iso("2025-11-14T03:17:00.000Z"),
    createdAt: daysAgo(900),
    lastActivityAt: daysAgo(900),
  });
  await runRetention(testEnv(), NOW);
  expect(await remaining()).toEqual(["a"]);
});

test("junk goes 30 days after creation, whatever the product's months", async () => {
  await seed("j31", { junk: 1, createdAt: daysAgo(31), lastActivityAt: daysAgo(1) });
  await seed("j29", { junk: 1, createdAt: daysAgo(29), lastActivityAt: daysAgo(40) });
  await runRetention(testEnv(), NOW);
  expect(await remaining()).toEqual(["j29"]);
});

test("each product's own retention_months applies", async () => {
  await baseEnv.DB.exec("UPDATE products SET retention_months = 6 WHERE slug = 'deaftly'");
  const sevenMonthsAgo = iso("2026-04-12T03:17:00.000Z");
  const fiveMonthsAgo = iso("2026-06-14T03:17:00.000Z");
  await seed("deaftly-old", { product: "deaftly", lastActivityAt: sevenMonthsAgo });
  await seed("deaftly-new", { product: "deaftly", lastActivityAt: fiveMonthsAgo });
  await seed("cl-seven", { product: "cl", lastActivityAt: sevenMonthsAgo });
  await runRetention(testEnv(), NOW);
  expect(await remaining()).toEqual(["cl-seven", "deaftly-new"]);
});

test("every deletion is audited as system:retention", async () => {
  await seed("one", { junk: 1, createdAt: daysAgo(40) });
  await seed("two", { junk: 1, createdAt: daysAgo(41) });
  await runRetention(testEnv(), NOW);
  const { results } = await baseEnv.DB.prepare(
    "SELECT actor, action, target_id FROM audit_events WHERE action = 'item.deleted' ORDER BY target_id",
  ).all();
  expect(results).toEqual([
    { actor: "system:retention", action: "item.deleted", target_id: "one" },
    { actor: "system:retention", action: "item.deleted", target_id: "two" },
  ]);
});

/**
 * Junk items `prefix0000`… created a day apart going back from 100 days ago, so a lower number is newer.
 * @param {string} prefix
 * @param {number} count
 */
async function seedMany(prefix, count) {
  await baseEnv.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i + 1 < ?)
     INSERT INTO items (id, product, kind, source, junk, created_at, last_activity_at)
     SELECT ? || printf('%04d', i), 'cl', 'feedback', 'web', 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-' || (100 + i) || ' days'),
       strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-' || (100 + i) || ' days')
     FROM n`,
  )
    .bind(count, prefix, NOW.toISOString(), NOW.toISOString())
    .run();
}

/**
 * Counts D1 calls the way the per-invocation query limit does: a batch is one.
 * @param {import("../src/lib/db.js").Database} db
 */
function countingDb(db) {
  const counter = { queries: 0 };
  const raw = new WeakMap();
  /** @param {any} statement */
  const wrap = statement => {
    /** @param {"first" | "all" | "run"} method */
    const counted = method => () => {
      counter.queries++;
      return statement[method]();
    };
    const wrapped = {
      bind: (/** @type {unknown[]} */ ...values) => wrap(statement.bind(...values)),
      first: counted("first"),
      all: counted("all"),
      run: counted("run"),
    };
    raw.set(wrapped, statement);
    return wrapped;
  };
  return {
    counter,
    db: {
      prepare: (/** @type {string} */ sql) => wrap(db.prepare(sql)),
      batch: (/** @type {any[]} */ statements) => {
        counter.queries++;
        return db.batch(statements.map(statement => raw.get(statement) ?? statement));
      },
    },
  };
}

test("a run deletes at most 2,000 items, oldest first, in batches", async () => {
  await seedMany("j", 2001);
  await seed("newest", { junk: 1, createdAt: daysAgo(31) });
  expect(await runRetention(testEnv(), NOW)).toEqual({ deleted: 2000, failed: 0 });
  expect(await remaining()).toEqual(["j0000", "newest"]);
}, 60_000);

test("a full run stays far inside D1's 1,000 queries per invocation", async () => {
  await seedMany("j", 2001);
  const { counter, db } = countingDb(baseEnv.DB);
  await runRetention(makeEnv({ ATTACHMENTS: makeBucket(), DB: db }), NOW);
  expect(counter.queries).toBeLessThanOrEqual(110);
}, 60_000);

test("a failing batch is retried item by item, the failing item is logged by error name only and skipped, and the run stops", async () => {
  await seedMany("j", 150);
  await seed("bad", { junk: 1, createdAt: daysAgo(900) });
  await baseEnv.DB.exec(
    "INSERT INTO messages (id, item_id, direction, body_text, created_at) VALUES ('m', 'bad', 'in', 'secret words', 'x')",
  );
  await baseEnv.DB.exec(
    "INSERT INTO attachments (id, item_id, message_id, r2_key, size) VALUES ('a', 'bad', 'm', 'k/secret', 1)",
  );
  const bucket = makeBucket();
  bucket.delete = async keys => {
    if ([keys].flat().includes("k/secret")) throw new TypeError("secret words");
  };
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const result = await runRetention(makeEnv({ ATTACHMENTS: bucket }), NOW);
  expect(result).toEqual({ deleted: 99, failed: 1 });
  expect(await remaining()).toHaveLength(52);
  expect(await remaining()).toContain("bad");
  expect(error).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
  for (const call of [error.mock.calls[0][0], warn.mock.calls[0][0]]) {
    expect(String(call)).not.toContain("secret");
    expect(String(call)).not.toContain("bad");
  }
  expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({
    event: "retention.batch-failed",
    errorName: "TypeError",
  });
  expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({
    event: "retention.delete-failed",
    errorName: "TypeError",
  });
});

test("nothing due means nothing deleted", async () => {
  await seed("fresh");
  expect(await runRetention(testEnv(), NOW)).toEqual({ deleted: 0, failed: 0 });
});

test("subtractMonths uses UTC calendar months and clamps to the end of the target month", () => {
  const sub = (/** @type {string} */ from, /** @type {number} */ months) =>
    subtractMonths(new Date(from), months).toISOString();
  expect(sub("2026-03-31T10:00:00.000Z", 1)).toBe("2026-02-28T10:00:00.000Z");
  expect(sub("2028-03-31T10:00:00.000Z", 1)).toBe("2028-02-29T10:00:00.000Z");
  expect(sub("2026-05-31T10:00:00.000Z", 3)).toBe("2026-02-28T10:00:00.000Z");
  expect(sub("2026-11-13T03:17:00.000Z", 12)).toBe("2025-11-13T03:17:00.000Z");
  expect(sub("2026-01-15T00:00:00.000Z", 2)).toBe("2025-11-15T00:00:00.000Z");
  expect(sub("2024-02-29T00:00:00.000Z", 12)).toBe("2023-02-28T00:00:00.000Z");
  expect(sub("2026-08-31T23:59:59.999Z", 6)).toBe("2026-02-28T23:59:59.999Z");
});

test("the scheduled handler runs retention at the scheduled time, through waitUntil", async () => {
  await seed("old", { junk: 1, createdAt: iso("2026-10-01T00:00:00.000Z") });
  await seed("young", { junk: 1, createdAt: iso("2026-10-20T00:00:00.000Z") });
  const ctx = makeCtx();
  await worker.scheduled({ scheduledTime: NOW.getTime(), cron: "17 3 * * *" }, testEnv(), ctx);
  await ctx.settled();
  expect(await remaining()).toEqual(["young"]);
});
