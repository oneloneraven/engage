import { env as baseEnv } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { handleInboundEmail, parseAuthResults } from "../src/email/inbound.js";
import { htmlToText } from "../src/email/html-text.js";
import { makeReplyAddress } from "../src/email/reply-address.js";
import worker from "../src/worker.js";
import attachmentEml from "./fixtures/email/attachment.eml?raw";
import dmarcFailEml from "./fixtures/email/dmarc-fail.eml?raw";
import helloEml from "./fixtures/email/hello.eml?raw";
import htmlOnlyEml from "./fixtures/email/html-only.eml?raw";
import noFromEml from "./fixtures/email/no-from.eml?raw";
import quotedPrintableEml from "./fixtures/email/quoted-printable.eml?raw";
import replyEml from "./fixtures/email/reply.eml?raw";
import { makeBucket, makeCtx, makeEmailMessage, makeEnv, resetItems, stubFetch } from "./helpers.js";

const SECRET = "reply-secret";
const ITEM_ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const THEN = "2026-01-01T00:00:00.000Z";
const REJECTION = "Address does not exist";

/** @param {Record<string, unknown>} [overrides] */
function inboundEnv(overrides = {}) {
  return makeEnv({ REPLY_ADDRESS_SECRET: SECRET, ATTACHMENTS: makeBucket(), ...overrides });
}

/**
 * @param {string} to
 * @param {string} raw
 * @param {{ env?: any, forwardFails?: boolean }} [options]
 */
async function receive(to, raw, { env = inboundEnv(), forwardFails = false } = {}) {
  const message = makeEmailMessage({ to, raw, forwardFails });
  const ctx = makeCtx();
  await handleInboundEmail(/** @type {any} */ (message), env, ctx);
  await ctx.settled();
  return message;
}

async function items() {
  const { results } = await baseEnv.DB.prepare("SELECT * FROM items ORDER BY created_at").all();
  return results;
}

async function messages() {
  const { results } = await baseEnv.DB.prepare("SELECT * FROM messages ORDER BY created_at, id").all();
  return results;
}

async function seedItem() {
  await baseEnv.DB.prepare(
    "INSERT INTO items (id, product, kind, source, subject, contact_email, read_at, created_at, last_activity_at) VALUES (?, 'cl', 'email', 'email', 'Question about grades', 'alex@example.org', ?, ?, ?)",
  )
    .bind(ITEM_ID, THEN, THEN, THEN)
    .run();
}

const replyAddress = (/** @type {string} */ domain = "climbinglogbook.com") =>
  makeReplyAddress(ITEM_ID, domain, SECRET);

/** @type {ReturnType<typeof stubFetch>} */
let fetches;

beforeEach(async () => {
  await resetItems();
  await baseEnv.DB.exec("DELETE FROM blocklist");
  fetches = stubFetch();
});

afterEach(() => vi.restoreAllMocks());

test("hello@ with DMARC pass makes an email item, stores the message and pings once", async () => {
  const message = await receive("hello@climbinglogbook.com", helloEml);
  expect(message.rejected).toEqual([]);

  const [item] = await items();
  expect(item).toMatchObject({
    product: "cl",
    kind: "email",
    source: "email",
    subject: "Question about grades",
    contact_email: "alex@example.org",
    contact_name: "Alex Climber",
    junk: 0,
    read_at: null,
  });
  expect(JSON.parse(String(item.auth_result))).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });
  expect(item.last_activity_at).toBe(item.created_at);

  const [stored] = await messages();
  expect(stored).toMatchObject({
    item_id: item.id,
    direction: "in",
    from_addr: "alex@example.org",
    body_text: "Does the app support French grades?\n",
    rfc_message_id: "<hello-1@mail.example.org>",
  });

  expect(fetches.discord()).toHaveLength(1);
  expect(fetches.discord()[0].body.content).toContain("New email");
  expect(fetches.discord()[0].body.content).toContain(`/items/${item.id}`);
});

test("an alias makes an email item the same way", async () => {
  await receive("support@climbinglogbook.com", helloEml);
  expect(await items()).toHaveLength(1);
  expect(fetches.discord()).toHaveLength(1);
});

test("local parts and domains match without regard to case", async () => {
  const message = await receive("HeLLo@ClimbingLogbook.COM", helloEml);
  expect(message.rejected).toEqual([]);
  expect(await items()).toHaveLength(1);
});

test("the product is chosen by the recipient's domain", async () => {
  await receive("hello@deaftly.com", helloEml);
  expect((await items())[0].product).toBe("deaftly");
});

test("an unknown local part is rejected and nothing is stored", async () => {
  const message = await receive("nobody@climbinglogbook.com", helloEml);
  expect(message.rejected).toEqual([REJECTION]);
  expect(await items()).toEqual([]);
  expect(fetches.discord()).toHaveLength(0);
});

test("an alias belongs to its own product only", async () => {
  const message = await receive("support@deaftly.com", helloEml);
  expect(message.rejected).toEqual([REJECTION]);
});

test("an unknown domain is rejected", async () => {
  const message = await receive("hello@unknown.example", helloEml);
  expect(message.rejected).toEqual([REJECTION]);
  expect(await items()).toEqual([]);
});

test("a recipient with no domain is rejected", async () => {
  const message = await receive("hello", helloEml);
  expect(message.rejected).toEqual([REJECTION]);
});

test("DMARC fail is stored as junk with no ping", async () => {
  await receive("hello@climbinglogbook.com", dmarcFailEml);
  const [item] = await items();
  expect(item.junk).toBe(1);
  expect(JSON.parse(String(item.auth_result))).toEqual({ spf: "fail", dkim: "none", dmarc: "fail" });
  expect(await messages()).toHaveLength(1);
  expect(fetches.discord()).toHaveLength(0);
});

test("a sender on the blocklist by exact address is junk with no ping", async () => {
  await baseEnv.DB.prepare("INSERT INTO blocklist (pattern, created_at) VALUES ('alex@example.org', ?)")
    .bind(THEN)
    .run();
  await receive("hello@climbinglogbook.com", helloEml);
  expect((await items())[0].junk).toBe(1);
  expect(fetches.discord()).toHaveLength(0);
});

test("a sender on the blocklist by domain is junk with no ping", async () => {
  await baseEnv.DB.prepare("INSERT INTO blocklist (pattern, created_at) VALUES ('@example.org', ?)").bind(THEN).run();
  await receive("hello@climbinglogbook.com", helloEml);
  expect((await items())[0].junk).toBe(1);
  expect(fetches.discord()).toHaveLength(0);
});

test("a blocklist entry for another sender or domain does not match", async () => {
  await baseEnv.DB.prepare(
    "INSERT INTO blocklist (pattern, created_at) VALUES ('@other.example', ?), ('al@example.org', ?)",
  )
    .bind(THEN, THEN)
    .run();
  await receive("hello@climbinglogbook.com", helloEml);
  expect((await items())[0].junk).toBe(0);
});

test("a missing From is stored as junk and does not throw", async () => {
  const message = await receive("hello@climbinglogbook.com", noFromEml);
  expect(message.rejected).toEqual([]);
  const [item] = await items();
  expect(item).toMatchObject({ junk: 1, contact_email: null, subject: "Who am I" });
  expect((await messages())[0]).toMatchObject({ from_addr: null, body_text: "No sender header here.\n" });
  expect(fetches.discord()).toHaveLength(0);
});

test("a valid reply is appended to its item, marks it unread, and pings as a reply", async () => {
  await seedItem();
  const message = await receive(await replyAddress(), replyEml);
  expect(message.rejected).toEqual([]);

  expect(await items()).toHaveLength(1);
  const [item] = await items();
  expect(item.read_at).toBeNull();
  expect(item.last_activity_at).not.toBe(THEN);
  expect(item.subject).toBe("Question about grades");

  const [stored] = await messages();
  expect(stored).toMatchObject({
    item_id: ITEM_ID,
    direction: "in",
    from_addr: "alex@example.org",
    body_text: "Thanks, that works for me.\n",
    rfc_message_id: "<reply-1@mail.example.org>",
  });
  expect(fetches.discord()).toHaveLength(1);
  expect(fetches.discord()[0].body.content).toContain("New reply");
  expect(fetches.discord()[0].body.content).toContain(`/items/${ITEM_ID}`);
});

test("a mixed-case reply address still reaches its item", async () => {
  await seedItem();
  const message = await receive((await replyAddress()).toUpperCase(), replyEml);
  expect(message.rejected).toEqual([]);
  expect(await messages()).toHaveLength(1);
});

test("a reply that fails DMARC is appended but neither marks the item unread nor pings", async () => {
  await seedItem();
  await receive(await replyAddress(), replyEml.replace("dmarc=pass", "dmarc=fail"));
  expect(await messages()).toHaveLength(1);
  const [item] = await items();
  expect(item.read_at).toBe(THEN);
  expect(item.last_activity_at).not.toBe(THEN);
  expect(item.junk).toBe(0);
  expect(fetches.discord()).toHaveLength(0);
});

test("a reply from a blocklisted sender is appended quietly", async () => {
  await seedItem();
  await baseEnv.DB.prepare("INSERT INTO blocklist (pattern, created_at) VALUES ('@example.org', ?)").bind(THEN).run();
  await receive(await replyAddress(), replyEml);
  expect(await messages()).toHaveLength(1);
  expect((await items())[0].read_at).toBe(THEN);
  expect(fetches.discord()).toHaveLength(0);
});

test("a forged reply address is rejected and nothing is stored", async () => {
  await seedItem();
  const forged = `reply+${ITEM_ID.toLowerCase()}.0000000000000000@climbinglogbook.com`;
  const message = await receive(forged, replyEml);
  expect(message.rejected).toEqual([REJECTION]);
  expect(await messages()).toEqual([]);
  expect((await items())[0].read_at).toBe(THEN);
  expect(fetches.discord()).toHaveLength(0);
});

test.each([
  "reply+@climbinglogbook.com",
  "reply+abc@climbinglogbook.com",
  "reply+01jabcdefghjkmnpqrstvwxyz0.abcd@climbinglogbook.com",
  "reply@climbinglogbook.com",
])("a malformed or truncated reply address %s is rejected", async address => {
  await seedItem();
  const message = await receive(address, replyEml);
  expect(message.rejected).toEqual([REJECTION]);
  expect(await messages()).toEqual([]);
});

test("a validly signed reply for an item that does not exist is rejected", async () => {
  const message = await receive(await replyAddress(), replyEml);
  expect(message.rejected).toEqual([REJECTION]);
});

test("a validly signed reply cannot be used on another product's domain", async () => {
  await seedItem();
  const message = await receive(await replyAddress("deaftly.com"), replyEml);
  expect(message.rejected).toEqual([REJECTION]);
  expect(await messages()).toEqual([]);
});

test("a missing reply secret rejects reply mail and logs the event by name only", async () => {
  await seedItem();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const message = await receive(await replyAddress(), replyEml, {
    env: inboundEnv({ REPLY_ADDRESS_SECRET: undefined }),
  });
  expect(message.rejected).toEqual([REJECTION]);
  expect(await messages()).toEqual([]);
  const logged = error.mock.calls.flat().join(" ");
  expect(logged).toContain("email.reply-secret-missing");
  expect(logged).not.toContain("example");
});

test("an HTML-only body is stripped to text and the HTML is kept", async () => {
  await receive("hello@climbinglogbook.com", htmlOnlyEml);
  const [stored] = await messages();
  expect(stored.body_text).toBe("Hello there & welcome back.\n\nTom <tom@example.org> said é😀�\n\nLine one\nLine two");
  expect(String(stored.body_html)).toContain("<b>there</b>");
  expect(String(stored.body_html)).toContain("<script>");
});

test("a plain-text message stores no HTML", async () => {
  await receive("hello@climbinglogbook.com", helloEml);
  expect((await messages())[0].body_html).toBeNull();
});

test("quoted-printable bodies and encoded subjects are decoded", async () => {
  await receive("hello@climbinglogbook.com", quotedPrintableEml);
  const [item] = await items();
  expect(item.subject).toBe("Café grades");
  expect((await messages())[0].body_text).toBe("Café grades are lovely, and this soft line break joins up again.\n");
});

test("a subject is truncated to 200 characters", async () => {
  const long = helloEml.replace("Subject: Question about grades", `Subject: ${"é".repeat(300)}`);
  await receive("hello@climbinglogbook.com", long);
  expect([...String((await items())[0].subject)]).toHaveLength(200);
});

test("a message with no subject stores none", async () => {
  await receive("hello@climbinglogbook.com", helloEml.replace(/^Subject:.*\n/m, ""));
  expect((await items())[0].subject).toBeNull();
});

test("an attachment goes to R2 under the item and attachment ids, with a row describing it", async () => {
  const bucket = makeBucket();
  await receive("hello@climbinglogbook.com", attachmentEml, { env: inboundEnv({ ATTACHMENTS: bucket }) });
  const [item] = await items();
  const [stored] = await messages();
  const { results } = await baseEnv.DB.prepare("SELECT * FROM attachments").all();
  expect(results).toHaveLength(1);
  const [attachment] = results;
  expect(attachment).toMatchObject({
    item_id: item.id,
    message_id: stored.id,
    r2_key: `items/${item.id}/${attachment.id}`,
    filename: "notes.txt",
    content_type: "text/plain",
    size: 16,
  });
  expect([...bucket.objects.keys()]).toEqual([attachment.r2_key]);
  const object = bucket.objects.get(String(attachment.r2_key));
  expect(new TextDecoder().decode(object?.value)).toBe("hello attachment");
  expect(object?.options).toEqual({ httpMetadata: { contentType: "text/plain" } });
});

test("R2 objects are removed again when the database write fails", async () => {
  const bucket = makeBucket();
  const failing = inboundEnv({
    ATTACHMENTS: bucket,
    DB: {
      prepare: (/** @type {string} */ sql) => baseEnv.DB.prepare(sql),
      batch: async () => {
        throw new Error("d1 unavailable");
      },
    },
  });
  await expect(receive("hello@climbinglogbook.com", attachmentEml, { env: failing })).rejects.toThrow("d1 unavailable");
  expect(bucket.objects.size).toBe(0);
});

test("a reply's attachment is stored under the existing item", async () => {
  await seedItem();
  const bucket = makeBucket();
  await receive(await replyAddress(), attachmentEml, { env: inboundEnv({ ATTACHMENTS: bucket }) });
  expect([...bucket.objects.keys()][0]).toMatch(new RegExp(`^items/${ITEM_ID}/`));
});

test("backupForwardTo forwards the message once", async () => {
  await baseEnv.DB.exec("UPDATE products SET backup_forward_to = 'backup@example.net' WHERE slug = 'cl'");
  try {
    const message = await receive("hello@climbinglogbook.com", helloEml);
    expect(message.forwarded).toEqual(["backup@example.net"]);
    expect(await items()).toHaveLength(1);
  } finally {
    await baseEnv.DB.exec("UPDATE products SET backup_forward_to = NULL WHERE slug = 'cl'");
  }
});

test("a backup forward that fails is logged by name only and the message is still stored", async () => {
  await baseEnv.DB.exec("UPDATE products SET backup_forward_to = 'backup@example.net' WHERE slug = 'cl'");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const message = await receive("hello@climbinglogbook.com", helloEml, { forwardFails: true });
    expect(message.forwarded).toHaveLength(1);
    expect(await items()).toHaveLength(1);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("email.forward-failed");
    expect(logged).not.toContain("backup@example.net");
  } finally {
    await baseEnv.DB.exec("UPDATE products SET backup_forward_to = NULL WHERE slug = 'cl'");
  }
});

test("nothing is forwarded without backupForwardTo, or for a rejected recipient", async () => {
  const plain = await receive("hello@climbinglogbook.com", helloEml);
  expect(plain.forwarded).toEqual([]);
  await baseEnv.DB.exec("UPDATE products SET backup_forward_to = 'backup@example.net' WHERE slug = 'cl'");
  try {
    const rejected = await receive("nobody@climbinglogbook.com", helloEml);
    expect(rejected.forwarded).toEqual([]);
  } finally {
    await baseEnv.DB.exec("UPDATE products SET backup_forward_to = NULL WHERE slug = 'cl'");
  }
});

test("an unparseable message is stored as junk rather than lost, and does not throw", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const levels = Array.from(
    { length: 300 },
    (_, level) => `--x${level}\nContent-Type: multipart/mixed; boundary="x${level + 1}"\n\n`,
  );
  const nested = `${helloEml.split("\n\n")[0].replace("text/plain", 'multipart/mixed; boundary="x0"')}\n\n${levels.join("")}`;
  const message = await receive("hello@climbinglogbook.com", nested);
  expect(message.rejected).toEqual([]);
  const [item] = await items();
  expect(item).toMatchObject({ junk: 1, contact_email: null, subject: null });
  expect(await messages()).toHaveLength(1);
  expect(fetches.discord()).toHaveLength(0);
  const logged = error.mock.calls.flat().join(" ");
  expect(logged).toContain("email.parse-failed");
  expect(logged).not.toContain("example");
});

test("the worker's email export hands the message to the inbound handler", async () => {
  const message = makeEmailMessage({ to: "hello@climbinglogbook.com", raw: helloEml });
  const ctx = makeCtx();
  await worker.email(/** @type {any} */ (message), inboundEnv(), ctx);
  await ctx.settled();
  expect(await items()).toHaveLength(1);
});

test("logs carry no addresses, subjects or bodies on any path", async () => {
  const spies = ["info", "warn", "error", "log"]./** @type {const} */
  map(level => vi.spyOn(console, level).mockImplementation(() => {}));
  await baseEnv.DB.exec("UPDATE products SET backup_forward_to = 'backup@example.net' WHERE slug = 'cl'");
  try {
    await receive("hello@climbinglogbook.com", helloEml, { forwardFails: true });
    await receive("nobody@climbinglogbook.com", helloEml);
    await receive("hello@climbinglogbook.com", dmarcFailEml);
  } finally {
    await baseEnv.DB.exec("UPDATE products SET backup_forward_to = NULL WHERE slug = 'cl'");
  }
  const logged = spies.flatMap(spy => spy.mock.calls.flat()).join(" ");
  for (const secret of ["example.org", "climbinglogbook", "backup@", "grades", "French", "Click here"]) {
    expect(logged).not.toContain(secret);
  }
});

test.each([
  [
    "mx.example; dkim=pass header.d=a.example; spf=pass; dmarc=pass header.from=a.example",
    { spf: "pass", dkim: "pass", dmarc: "pass" },
  ],
  [null, { spf: "none", dkim: "none", dmarc: "none" }],
  ["", { spf: "none", dkim: "none", dmarc: "none" }],
  ["mx.example; spf=pass", { spf: "pass", dkim: "none", dmarc: "none" }],
  ["mx.example; DMARC=FAIL (p=reject) header.from=a.example", { spf: "none", dkim: "none", dmarc: "fail" }],
  ["mx.example; spf=softfail; dkim=neutral; dmarc=bestguesspass", { spf: "fail", dkim: "none", dmarc: "none" }],
  ["mx.example; spf=temperror; dkim=permerror; dmarc=permerror", { spf: "none", dkim: "none", dmarc: "none" }],
  ["mx.example; x-dkim=pass; header.dmarc=pass", { spf: "none", dkim: "none", dmarc: "none" }],
  ["mx.example; dkim=pass header.d=a.example, mx.example; dkim=fail", { spf: "none", dkim: "fail", dmarc: "none" }],
  ["mx.example; dmarc=fail, other.example; dmarc=pass", { spf: "none", dkim: "none", dmarc: "fail" }],
])("Authentication-Results %j parses to %j", (header, expected) => {
  expect(parseAuthResults(header)).toEqual(expected);
});

test("duplicate Authentication-Results headers are all read, and a failure wins", async () => {
  const raw = helloEml.replace(
    "From:",
    "Authentication-Results: other.example; dmarc=fail header.from=example.org\nFrom:",
  );
  await receive("hello@climbinglogbook.com", raw);
  const [item] = await items();
  expect(item.junk).toBe(1);
  expect(JSON.parse(String(item.auth_result)).dmarc).toBe("fail");
});

test("no Authentication-Results header means none, and is not junk", async () => {
  await receive("hello@climbinglogbook.com", helloEml.replace(/^Authentication-Results:.*\n/m, ""));
  const [item] = await items();
  expect(JSON.parse(String(item.auth_result))).toEqual({ spf: "none", dkim: "none", dmarc: "none" });
  expect(item.junk).toBe(0);
});

test.each([
  ["<p>One</p><p>Two</p>", "One\n\nTwo"],
  ["a<br>b<br/>c", "a\nb\nc"],
  ["<style>x{}</style><script>y()</script>text", "text"],
  ["<!-- hidden -->visible", "visible"],
  ["&lt;b&gt; &amp;amp; &quot;q&quot; &apos;s&apos; &nbsp;x", "<b> &amp; \"q\" 's'  x".replace("  x", " x")],
  ["&#65;&#x42;&#0;&#xD800;&#1114112;&unknown;", "AB���&unknown;"],
  ["  lots   of \t space  ", "lots of space"],
  ["<ul><li>a</li><li>b</li></ul>", "a\nb"],
  ["<p>unclosed <b>tag", "unclosed tag"],
  ["", ""],
])("htmlToText(%j) is %j", (html, expected) => {
  expect(htmlToText(html)).toBe(expected);
});
