import { beforeEach, expect, test, vi } from "vitest";
import { env } from "cloudflare:test";
import { parseReplyAddress } from "../src/email/reply-address.js";
import { sendReply } from "../src/email/outbound.js";
import { getProduct } from "../src/registry.js";
import { makeEnv, resetItems } from "./helpers.js";

const SECRET = "reply-secret";
const ITEM_ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const ACTOR = "raven@example.com";
const THEN = "2026-01-01T00:00:00.000Z";

function fakeEmail({ messageId = "send-id-1", fail = false } = {}) {
  /** @type {any[]} */
  const sent = [];
  return {
    sent,
    send: async (/** @type {any} */ payload) => {
      sent.push(payload);
      if (fail) throw Object.assign(new Error("secret text to@example.com"), { code: "E_DELIVERY_FAILED" });
      return messageId === null ? {} : { messageId };
    },
  };
}

/** @param {{ kind?: string, subject?: string | null, contactEmail?: string | null }} [overrides] */
async function seedItem({ kind = "feedback", subject = "Crash on save", contactEmail = "climber@example.org" } = {}) {
  await env.DB.prepare(
    "INSERT INTO items (id, product, kind, source, subject, contact_email, reply_owed_at, created_at, last_activity_at) VALUES (?, 'cl', ?, 'web', ?, ?, ?, ?, ?)",
  )
    .bind(ITEM_ID, kind, subject, contactEmail, THEN, THEN, THEN)
    .run();
  return { id: ITEM_ID, product: "cl", contactEmail, subject };
}

async function seedInbound(id, rfcMessageId, createdAt) {
  await env.DB.prepare(
    "INSERT INTO messages (id, item_id, direction, from_addr, body_text, rfc_message_id, created_at) VALUES (?, ?, 'in', 'climber@example.org', 'hi', ?, ?)",
  )
    .bind(id, ITEM_ID, rfcMessageId, createdAt)
    .run();
}

async function product() {
  const found = await getProduct(env, "cl");
  if (!found) throw new Error("seed missing");
  return found;
}

beforeEach(async () => {
  await resetItems();
  await env.DB.exec("DELETE FROM audit_events");
});

test("sends from the product's own address, to the contact, with the given text", async () => {
  const email = fakeEmail();
  const item = await seedItem();
  await sendReply(
    makeEnv({ EMAIL: email, REPLY_ADDRESS_SECRET: SECRET }),
    item,
    await product(),
    "Thanks, fixed.",
    ACTOR,
  );
  expect(email.sent).toHaveLength(1);
  expect(email.sent[0]).toMatchObject({
    from: { name: "Climbing Logbook", email: "hello@climbinglogbook.com" },
    to: "climber@example.org",
    subject: "Re: Crash on save",
    text: "Thanks, fixed.",
  });
});

test("sets a signed Reply-To that parses back to the item", async () => {
  const email = fakeEmail();
  const item = await seedItem();
  await sendReply(makeEnv({ EMAIL: email, REPLY_ADDRESS_SECRET: SECRET }), item, await product(), "Hi", ACTOR);
  const { replyTo } = email.sent[0];
  expect(replyTo).toMatch(/^reply\+.+@climbinglogbook\.com$/);
  expect(await parseReplyAddress(replyTo, SECRET)).toBe(ITEM_ID);
});

test("threads to the latest inbound message id", async () => {
  const email = fakeEmail();
  const item = await seedItem();
  await seedInbound("M1", "<old@mail.example>", "2026-01-01T01:00:00.000Z");
  await seedInbound("M2", "<new@mail.example>", "2026-01-01T02:00:00.000Z");
  await sendReply(makeEnv({ EMAIL: email, REPLY_ADDRESS_SECRET: SECRET }), item, await product(), "Hi", ACTOR);
  expect(email.sent[0].headers).toEqual({ "In-Reply-To": "<new@mail.example>", References: "<new@mail.example>" });
});

test("sends no threading headers when nothing inbound has a message id", async () => {
  const email = fakeEmail();
  const item = await seedItem();
  await seedInbound("M1", null, "2026-01-01T01:00:00.000Z");
  await sendReply(makeEnv({ EMAIL: email, REPLY_ADDRESS_SECRET: SECRET }), item, await product(), "Hi", ACTOR);
  expect(email.sent[0].headers).toBeUndefined();
});

test.each([
  ["issue", "Re: Your report about Climbing Logbook"],
  ["feedback", "Re: Your feedback about Climbing Logbook"],
  ["email", "Re: Your message about Climbing Logbook"],
])("a %s item without a subject gets a generated subject", async (kind, expected) => {
  const email = fakeEmail();
  const item = await seedItem({ kind, subject: null });
  await sendReply(makeEnv({ EMAIL: email, REPLY_ADDRESS_SECRET: SECRET }), item, await product(), "Hi", ACTOR);
  expect(email.sent[0].subject).toBe(expected);
});

test("stores the sent message, updates the item, and audits without content", async () => {
  const email = fakeEmail({ messageId: "<sent@cloudflare.example>" });
  const item = await seedItem();
  const result = await sendReply(
    makeEnv({ EMAIL: email, REPLY_ADDRESS_SECRET: SECRET }),
    item,
    await product(),
    "Private reply text",
    ACTOR,
  );
  expect(result.messageId).toHaveLength(26);

  const message = await env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(result.messageId).first();
  expect(message).toMatchObject({
    item_id: ITEM_ID,
    direction: "out",
    from_addr: "hello@climbinglogbook.com",
    body_text: "Private reply text",
    rfc_message_id: "<sent@cloudflare.example>",
  });

  const row = await env.DB.prepare("SELECT reply_owed_at, last_activity_at FROM items WHERE id = ?")
    .bind(ITEM_ID)
    .first();
  expect(row?.reply_owed_at).toBeNull();
  expect(row?.last_activity_at).not.toBe(THEN);

  const { results } = await env.DB.prepare("SELECT * FROM audit_events").all();
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    actor: ACTOR,
    action: "reply.sent",
    target_type: "item",
    target_id: ITEM_ID,
    detail: JSON.stringify({ messageId: result.messageId }),
  });
});

test("stores a null message id when the binding returns none", async () => {
  const email = fakeEmail({ messageId: null });
  const item = await seedItem();
  const { messageId } = await sendReply(
    makeEnv({ EMAIL: email, REPLY_ADDRESS_SECRET: SECRET }),
    item,
    await product(),
    "Hi",
    ACTOR,
  );
  const row = await env.DB.prepare("SELECT rfc_message_id FROM messages WHERE id = ?").bind(messageId).first();
  expect(row?.rfc_message_id).toBeNull();
});

test("no contact email throws no-contact and sends nothing", async () => {
  const email = fakeEmail();
  const item = await seedItem({ contactEmail: null });
  await expect(
    sendReply(makeEnv({ EMAIL: email, REPLY_ADDRESS_SECRET: SECRET }), item, await product(), "Hi", ACTOR),
  ).rejects.toThrow("no-contact");
  expect(email.sent).toHaveLength(0);
});

test("a missing reply-address secret throws reply-secret-missing and sends nothing", async () => {
  const email = fakeEmail();
  const item = await seedItem();
  await expect(sendReply(makeEnv({ EMAIL: email }), item, await product(), "Hi", ACTOR)).rejects.toThrow(
    "reply-secret-missing",
  );
  expect(email.sent).toHaveLength(0);
});

test("a failed send throws send-failed, changes nothing and logs only the code", async () => {
  const email = fakeEmail({ fail: true });
  const item = await seedItem();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    sendReply(makeEnv({ EMAIL: email, REPLY_ADDRESS_SECRET: SECRET }), item, await product(), "Secret body", ACTOR),
  ).rejects.toThrow("send-failed");

  const messages = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages").first();
  expect(messages?.n).toBe(0);
  const row = await env.DB.prepare("SELECT reply_owed_at, last_activity_at FROM items WHERE id = ?")
    .bind(ITEM_ID)
    .first();
  expect(row).toEqual({ reply_owed_at: THEN, last_activity_at: THEN });
  const audits = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events").first();
  expect(audits?.n).toBe(0);

  const logged = error.mock.calls.map(call => String(call[0])).join("\n");
  expect(logged).toContain("E_DELIVERY_FAILED");
  expect(logged).not.toContain("climber@example.org");
  expect(logged).not.toContain("Secret body");
  expect(logged).not.toContain("to@example.com");
  error.mockRestore();
});
