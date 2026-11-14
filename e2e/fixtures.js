export const BROWSER_NAMES = ["chrome", "firefox", "safari"];

export const SHARED_OWED = "e2e-shared-owed";
export const HOSTILE_MESSAGE = "<img src=x onerror=alert(1)>\n```\n@raven `code` <b>bold</b>";
export const CONSENT_MESSAGE = "Love the offline mode. It never loses my logbook.";
export const FORMATTED_HTML =
  '<p id="formatted" style="color: rgb(160, 0, 0)">Formatted hello</p>' +
  "<script>document.body.insertAdjacentHTML('beforeend', '<p id=\"ran\">Script ran</p>')</script>";
export const ISSUE_URL = "https://github.com/oneloneraven/climbing-logbook/issues/7";

/** @param {string} browserName */
export function idsFor(browserName) {
  const prefix = `e2e-${browserName.toLowerCase()}`;
  return {
    hostile: `${prefix}-hostile`,
    noEmail: `${prefix}-no-email`,
    consent: `${prefix}-consent`,
    email: `${prefix}-email`,
    unread: `${prefix}-unread`,
    star: `${prefix}-star`,
    archive: `${prefix}-archive`,
    remove: `${prefix}-remove`,
    junk: `${prefix}-junk`,
    linked: `${prefix}-linked`,
    reply: `${prefix}-reply`,
  };
}

/** @param {string | number | null} value */
const sql = value =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;

/**
 * @param {Record<string, string | number | null>} columns
 * @param {string} table
 */
const insert = (table, columns) =>
  `INSERT INTO ${table} (${Object.keys(columns).join(", ")}) VALUES (${Object.values(columns).map(sql).join(", ")});`;

/**
 * @param {{ id: string, product: string, kind: string, source: string, subject?: string | null, email?: string | null, name?: string | null, consent?: boolean, minutesAgo: number, read?: boolean, junk?: boolean, owed?: boolean, body: string, html?: string, issueNumber?: number, authResult?: string | null }} item
 * @param {Date} now
 */
function itemSql(item, now) {
  const at = new Date(now.getTime() - item.minutesAgo * 60_000).toISOString();
  return [
    insert("items", {
      id: item.id,
      product: item.product,
      kind: item.kind,
      source: item.source,
      subject: item.subject ?? null,
      contact_email: item.email ?? null,
      contact_name: item.name ?? null,
      quote_consent: item.consent ? 1 : 0,
      credit: item.consent ? "name" : null,
      app_version: item.source === "app" ? "2.4.1" : null,
      source_page: item.source === "web" ? "/help" : null,
      auth_result: item.authResult ?? null,
      junk: item.junk ? 1 : 0,
      read_at: item.read ? at : null,
      reply_owed_at: item.owed ? at : null,
      issue_number: item.issueNumber ?? null,
      issue_url: item.issueNumber ? ISSUE_URL.replace(/\d+$/, String(item.issueNumber)) : null,
      created_at: at,
      last_activity_at: at,
    }),
    insert("messages", {
      id: `${item.id}-m1`,
      item_id: item.id,
      direction: "in",
      from_addr: item.email ?? null,
      body_text: item.body,
      body_html: item.html ?? null,
      created_at: at,
    }),
  ].join("\n");
}

/** The fixture rows every e2e run starts from. Each browser gets its own items, so parallel browsers never meet. */
export function seedSql(now = new Date()) {
  const statements = [
    "DELETE FROM testimonials WHERE item_id LIKE 'e2e-%';",
    "DELETE FROM attachments WHERE item_id LIKE 'e2e-%';",
    "DELETE FROM messages WHERE item_id LIKE 'e2e-%';",
    "DELETE FROM items WHERE id LIKE 'e2e-%';",
    itemSql(
      {
        id: SHARED_OWED,
        product: "cl",
        kind: "issue",
        source: "app",
        subject: "The map is blank",
        email: "owed@example.test",
        name: "Alex",
        minutesAgo: 30,
        read: true,
        owed: true,
        body: "The map stays blank on my phone.",
      },
      now,
    ),
  ];
  for (const browserName of BROWSER_NAMES) {
    const ids = idsFor(browserName);
    statements.push(
      itemSql(
        {
          id: ids.hostile,
          product: "cl",
          kind: "feedback",
          source: "web",
          email: "hostile@example.test",
          minutesAgo: 1,
          body: HOSTILE_MESSAGE,
        },
        now,
      ),
      itemSql(
        {
          id: ids.noEmail,
          product: "cl",
          kind: "issue",
          source: "app",
          subject: `No email ${browserName}`,
          minutesAgo: 2,
          body: "I could not find the export button.",
        },
        now,
      ),
      itemSql(
        {
          id: ids.consent,
          product: "deaftly",
          kind: "feedback",
          source: "web",
          email: "sam@example.test",
          name: "Sam",
          consent: true,
          minutesAgo: 3,
          body: CONSENT_MESSAGE,
        },
        now,
      ),
      itemSql(
        {
          id: ids.email,
          product: "deaftly",
          kind: "email",
          source: "email",
          subject: `Question from ${browserName}`,
          email: "asker@example.test",
          minutesAgo: 4,
          read: true,
          authResult: '{"spf":"pass","dkim":"pass","dmarc":"pass"}',
          body: "Does it work with captions turned off?",
          html: FORMATTED_HTML,
        },
        now,
      ),
      itemSql(
        {
          id: ids.unread,
          product: "cl",
          kind: "email",
          source: "email",
          subject: `Unread subject ${browserName}`,
          email: "reader@example.test",
          minutesAgo: 5,
          body: "Is this read yet?",
        },
        now,
      ),
      itemSql(
        {
          id: ids.star,
          product: "cl",
          kind: "feedback",
          source: "web",
          subject: `Star me ${browserName}`,
          minutesAgo: 6,
          read: true,
          body: "Worth keeping.",
        },
        now,
      ),
      itemSql(
        {
          id: ids.archive,
          product: "cl",
          kind: "feedback",
          source: "web",
          subject: `Archive me ${browserName}`,
          minutesAgo: 7,
          read: true,
          body: "Dealt with.",
        },
        now,
      ),
      itemSql(
        {
          id: ids.remove,
          product: "cl",
          kind: "feedback",
          source: "web",
          subject: `Delete me ${browserName}`,
          minutesAgo: 8,
          read: true,
          body: "Please erase this.",
        },
        now,
      ),
      itemSql(
        {
          id: ids.junk,
          product: "cl",
          kind: "email",
          source: "email",
          subject: `Cheap pills ${browserName}`,
          email: "spam@example.test",
          minutesAgo: 9,
          read: true,
          junk: true,
          body: "Buy now.",
        },
        now,
      ),
      itemSql(
        {
          id: ids.linked,
          product: "cl",
          kind: "issue",
          source: "app",
          subject: `Already filed ${browserName}`,
          minutesAgo: 10,
          read: true,
          issueNumber: 7,
          body: "The export is empty.",
        },
        now,
      ),
      itemSql(
        {
          id: ids.reply,
          product: "cl",
          kind: "feedback",
          source: "web",
          subject: `Reply to me ${browserName}`,
          email: "replyee@example.test",
          minutesAgo: 11,
          read: true,
          body: "Can I export to CSV?",
        },
        now,
      ),
    );
  }
  return `${statements.join("\n")}\n`;
}
