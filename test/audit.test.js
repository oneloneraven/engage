import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { recordAudit } from "../src/audit.js";

test("recordAudit inserts one row with the detail JSON-encoded", async () => {
  await recordAudit(env, {
    actor: "raven@example.com",
    action: "item.star",
    targetType: "item",
    targetId: "abc",
    detail: { starred: true },
  });
  const { results } = await env.DB.prepare("SELECT * FROM audit_events").all();
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    actor: "raven@example.com",
    action: "item.star",
    target_type: "item",
    target_id: "abc",
    detail: '{"starred":true}',
  });
  expect(new Date(String(results[0].at)).toISOString()).toBe(results[0].at);
});

test("recordAudit stores a null detail when none is given", async () => {
  await recordAudit(env, { actor: "raven@example.com", action: "item.delete", targetType: "item", targetId: "xyz" });
  const row = await env.DB.prepare("SELECT detail FROM audit_events WHERE target_id = 'xyz'").first();
  expect(row?.detail).toBeNull();
});
