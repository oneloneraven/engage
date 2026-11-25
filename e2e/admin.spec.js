import { $, $$, browser, expect } from "@wdio/globals";
import { CONSENT_MESSAGE, HOSTILE_MESSAGE, ISSUE_URL, SHARED_OWED, SHARED_RELEASE, idsFor } from "./fixtures.js";

const ids = () => idsFor(String(browser.capabilities.browserName));
const row = id => $(`li[data-id="${id}"]`);

async function listLoaded() {
  await browser.waitUntil(async () => (await $$("ul.rows li")).length > 0 || (await $$(".empty")).length > 0);
}

const CL_INBOX = "/climbing-logbook/inbox";
const DEAFTLY_INBOX = "/deaftly/inbox";

/** Opens an item through its old address, which sends you to it inside its product's hub. */
async function openItem(id) {
  await browser.url(`/items/${id}`);
  await $(".item-title").waitForExist();
}

const toolbarButton = name => $(".toolbar").$(`button=${name}`);

afterEach(async () => {
  await browser.mockRestoreAll();
});

describe("home", () => {
  it("says what needs you, from the real data", async () => {
    await browser.url("/");
    await expect($("h1")).toHaveText("2 things need you.");
    await expect($(".summary")).toHaveText("Climbing Logbook has 2. Deaftly is quiet.");
    const cl = $('article[data-product="cl"]');
    await expect(cl).toHaveElementClass("needs");
    await expect(cl.$(`a[href="${CL_INBOX}/${SHARED_OWED}"]`)).toHaveText("The map is blank");
    await expect(cl.$(".release-row")).toBeExisting();
    await expect($('article[data-product="deaftly"]')).not.toHaveElementClass("needs");
    await expect($('article[data-product="deaftly"] .hub-needs .quiet')).toHaveText(
      expect.stringContaining("Nothing needs you here."),
    );
  });

  it("opens the item with the reply composer ready from a needs-you row", async () => {
    await browser.url("/");
    await $(`a[href="${CL_INBOX}/${SHARED_OWED}?reply"]`).click();
    await $("#reply-text").waitForExist();
    await expect($("#reply-text")).toBeFocused();
    expect(await browser.getUrl()).toContain(`${CL_INBOX}/${SHARED_OWED}?reply`);
  });

  it("says all clear when nothing is owed", async () => {
    await browser
      .mock("**/api/counts")
      .then(mock => mock.respond({ new: 0, open: 0, replyOwed: 0, releasesWaiting: 0, byProduct: {} }));
    await browser.mock("**/api/items*").then(mock => mock.respond({ items: [], next: null }));
    await browser.mock("**/api/releases*").then(mock => mock.respond({ releases: [] }));
    await browser.url("/");
    await expect($("h1")).toHaveText("All clear.");
    await expect($(".summary")).toHaveText("Nothing needs you. New feedback lands here and pings Discord.");
    await browser.mockRestoreAll();
  });

  it("shows the plural verdict and a card per product with its own counts", async () => {
    await browser.mock("**/api/counts").then(mock =>
      mock.respond({
        new: 3,
        open: 5,
        replyOwed: 6,
        releasesWaiting: 0,
        byProduct: {
          cl: { name: "Climbing Logbook", route: "climbing-logbook", new: 2, open: 3, replyOwed: 5 },
          deaftly: { name: "Deaftly", route: "deaftly", new: 1, open: 2, replyOwed: 1 },
        },
      }),
    );
    await browser.mock("**/api/items*").then(mock => mock.respond({ items: [], next: null }));
    await browser.mock("**/api/releases*").then(mock => mock.respond({ releases: [] }));
    await browser.url("/");
    await expect($("h1")).toHaveText("6 things need you.");
    await expect($(".summary")).toHaveText("Climbing Logbook has 5 and Deaftly has 1.");
    await expect($(`article[data-product="cl"] a[href="${CL_INBOX}?state=reply-owed"]`)).toHaveText(
      "See all 5 replies owed in the inbox",
    );
    await expect($('article[data-product="cl"]')).toHaveText(expect.stringContaining("Climbing Logbook"));
    await expect($(`article[data-product="cl"] a[href="${CL_INBOX}?state=new"]`)).toHaveText("2 new");
    await expect($(`article[data-product="cl"] a[href="${CL_INBOX}?state=open"]`)).toHaveText("3 open");
    await expect($(`article[data-product="deaftly"] a[href="${DEAFTLY_INBOX}?state=new"]`)).toHaveText("1 new");
    await browser.mockRestoreAll();
  });

  it("shows each product's health, engagement and beta from the real data", async () => {
    await browser.url("/");
    const cl = $('article[data-product="cl"]');
    await cl.waitForExist();
    await expect(cl.$(".health-pill")).toHaveText("Healthy");
    await expect(cl.$(".engagement .metric .muted")).toHaveText("Visits in the last 30 days, excluding EU visitors");
    await expect(cl.$(".engagement .numeral")).toHaveText("420");
    await expect(cl.$(".change")).toHaveText("Up 40% on last month");
    await expect(cl.$("svg.sparkline")).toBeExisting();
    await expect(cl.$(".beta-badge.amber")).toHaveText("Beta v1.15.0, 9 days ahead of production");
    await expect($('article[data-product="deaftly"] .health-pill')).toHaveText("Not monitored");
    await expect($('article[data-product="deaftly"] .engagement')).not.toBeExisting();
  });

  it("puts a failing product under Needs you, linking to Better Stack", async () => {
    const signals = (status, reason, link) => ({
      health: { status, reason, link, checkedAt: new Date().toISOString() },
      engagement: { label: "Visits", value: null, series: [], change: null },
      beta: null,
    });
    await browser.mock("**/api/counts").then(mock =>
      mock.respond({
        new: 0,
        open: 0,
        replyOwed: 0,
        releasesWaiting: 0,
        healthFailing: 1,
        byProduct: {
          cl: {
            name: "Climbing Logbook",
            route: "climbing-logbook",
            colour: "gold",
            new: 0,
            open: 0,
            replyOwed: 0,
            signals: signals("failing", "Climbing Logbook app is down", "https://uptime.example/monitors/1"),
          },
          deaftly: {
            name: "Deaftly",
            route: "deaftly",
            colour: "flame",
            new: 0,
            open: 0,
            replyOwed: 0,
            signals: signals("unknown", "Last checked 40 minutes ago", null),
          },
        },
      }),
    );
    await browser.mock("**/api/items*").then(mock => mock.respond({ items: [], next: null }));
    await browser.mock("**/api/releases*").then(mock => mock.respond({ releases: [] }));
    await browser.url("/");
    await expect($("h1")).toHaveText("1 thing needs you.");
    await expect($(".summary")).toHaveText("Climbing Logbook has 1. Deaftly is quiet.");
    const healthRow = $(".health-row");
    await expect(healthRow).toHaveText(expect.stringContaining("Climbing Logbook app is down"));
    await expect(healthRow.$("a")).toHaveAttribute("href", "https://uptime.example/monitors/1");
    await expect(healthRow.$("a")).toHaveAttribute("rel", "noopener noreferrer");
    await expect($('article[data-product="cl"] .health-pill')).toHaveText("Failing");
    await expect($('article[data-product="deaftly"] .health-reason')).toHaveText("Last checked 40 minutes ago");
    await expect($('article[data-product="cl"] .engagement .numeral')).toHaveText("No data yet");
    await expect($('article[data-product="cl"] svg.sparkline')).not.toBeExisting();
  });
});

describe("releases", () => {
  it("shows a waiting release on its product's card and in its product's releases", async () => {
    await browser.url("/");
    await expect($('a[href="/releases"]')).not.toBeExisting();
    const title = $(
      `article[data-product="cl"] .release-row .grow a[href="/climbing-logbook/releases/${SHARED_RELEASE}"]`,
    );
    await expect(title).toHaveText("v1.14.0 is waiting to go to production");
    await title.click();
    await expect($("h2.item-title")).toHaveText("v1.14.0 to production");
    await expect($(".panel").$("button=Approve release")).toBeExisting();
    await expect($(`.list-pane li[data-id="${SHARED_RELEASE}"] a`)).toHaveAttribute("aria-current", "true");
  });

  it("sends the old release links from Discord to the release in its product's hub", async () => {
    await browser.url(`/releases/${SHARED_RELEASE}`);
    await expect($("h2.item-title")).toHaveText("v1.14.0 to production");
    expect(new URL(await browser.getUrl()).pathname).toBe(`/climbing-logbook/releases/${SHARED_RELEASE}`);
    await browser.url("/releases");
    await $("h1.verdict").waitForExist();
    expect(new URL(await browser.getUrl()).pathname).toBe("/");
  });

  it("asks before rejecting, and shows GitHub's answer when the run no longer waits", async () => {
    await browser
      .mock(`**/api/releases/${SHARED_RELEASE}/reject`, { method: "post" })
      .then(mock => mock.respond({ error: "release-expired" }, { statusCode: 409 }));
    await browser.url(`/climbing-logbook/releases/${SHARED_RELEASE}`);
    await $(".panel").$("button=Reject").click();
    await expect($(".confirm")).toHaveText(expect.stringContaining("Reject this release?"));
    await $("button=Keep it waiting").click();
    await expect($(".panel").$("button=Approve release")).toBeExisting();
    await $(".panel").$("button=Reject").click();
    await $("button=Reject release").click();
    await expect($(".error")).toHaveText("GitHub no longer waits on this run: start it again.");
    await browser.mockRestoreAll();
  });

  it("approves with a note", async () => {
    const approve = await browser.mock(`**/api/releases/${SHARED_RELEASE}/approve`, { method: "post" });
    approve.respond({ release: { id: SHARED_RELEASE, state: "approved" } });
    await browser.url(`/climbing-logbook/releases/${SHARED_RELEASE}`);
    await $("#release-note").setValue("Ship it");
    await $(".panel").$("button=Approve release").click();
    await browser.waitUntil(async () => approve.calls.length > 0);
    expect(approve.calls[0].postData).toBe(JSON.stringify({ note: "Ship it" }));
  });
});

describe("health and usage", () => {
  it("lists each monitor with its status", async () => {
    await browser.url("/climbing-logbook/health");
    const monitor = $('.monitors li[data-status="up"]');
    await expect(monitor.$(".monitor-name")).toHaveText("Climbing Logbook app");
    await expect(monitor.$(".monitor-status")).toHaveText("Up");
  });

  it("shows each usage figure with its 90-day line", async () => {
    await browser.url("/climbing-logbook/usage");
    await expect($(".usage .engagement .metric .muted")).toHaveText(
      "Visits in the last 30 days, excluding EU visitors",
    );
    await expect($(".usage svg.sparkline")).toBeExisting();
  });

  it("shows every foundation page for a product with nothing set up, saying how to turn it on", async () => {
    await browser.mock("**/api/products/deaftly").then(mock =>
      mock.respond({
        slug: "deaftly",
        health: { status: "unmonitored", reason: null, link: null, checkedAt: null, monitors: [] },
        usage: [],
        gated: [],
      }),
    );
    await browser.mock("**/api/releases*").then(mock => mock.respond({ releases: [] }));
    for (const [page, text] of [
      ["releases", "No repositories are gated yet."],
      ["health", "No monitors yet."],
      ["usage", "No usage source yet."],
    ]) {
      await browser.url(`/deaftly/${page}`);
      await expect($(".setup-state")).toHaveText(expect.stringContaining(text));
      await expect($(".setup-state a")).toHaveAttribute("href", expect.stringContaining("/docs/runbooks/"));
    }
    const tabs = await $$(".hub-tabs a").map(a => a.getText());
    expect(tabs).toEqual(["Overview", "Inbox", "Releases", "Health", "Usage"]);
    await browser.mockRestoreAll();
  });
});

describe("inbox", () => {
  it("shows the first line of what they wrote under each row, as text", async () => {
    const { noEmail, hostile } = ids();
    await browser.url(CL_INBOX);
    await listLoaded();
    await expect(row(noEmail).$(".row-preview")).toHaveText("I could not find the export button.");
    await expect(row(hostile).$(".row-preview")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(row(hostile).$("img")).not.toBeExisting();
  });

  it("filters by search text, and keeps the filter across a reload", async () => {
    const { unread, star } = ids();
    await browser.url(CL_INBOX);
    await listLoaded();
    await expect(row(star)).toBeExisting();
    await $("#filter-q").setValue(`Unread subject ${browser.capabilities.browserName}`);
    await browser.waitUntil(async () => !(await row(star).isExisting()));
    await expect(row(unread)).toBeExisting();
    expect(await browser.getUrl()).toContain("q=Unread+subject");
    await browser.refresh();
    await expect($("#filter-q")).toHaveValue(`Unread subject ${browser.capabilities.browserName}`);
    await expect(row(unread)).toBeExisting();
    await expect(row(star)).not.toBeExisting();
  });

  it("shows only its own product's items, and filters by kind and state", async () => {
    const { consent, email, hostile, noEmail } = ids();
    await browser.url(DEAFTLY_INBOX);
    await listLoaded();
    await expect(row(consent)).toBeExisting();
    await expect(row(email)).toBeExisting();
    await expect(row(hostile)).not.toBeExisting();
    await $(".search-row").$("button=More filters").click();
    await $("#filter-kind").selectByAttribute("value", "email");
    await browser.waitUntil(async () => !(await row(consent).isExisting()));
    await expect(row(email)).toBeExisting();
    await browser.url(CL_INBOX);
    await listLoaded();
    await expect(row(noEmail)).toBeExisting();
    await $(".filter-chips").$("button=Reply owed").click();
    await browser.waitUntil(async () => !(await row(noEmail).isExisting()));
    await expect(row(SHARED_OWED)).toBeExisting();
    expect(await browser.getUrl()).toContain(`${CL_INBOX}?state=reply-owed`);
  });

  it("sends the old inbox address to the product's inbox, and anything else to search", async () => {
    await browser.url("/inbox?product=deaftly&state=reply-owed");
    await browser.waitUntil(async () => (await browser.getUrl()).includes(`${DEAFTLY_INBOX}?state=reply-owed`));
    await browser.url("/inbox?q=export");
    await browser.waitUntil(async () => (await browser.getUrl()).includes("/search?q=export"));
  });

  it("searches every product and opens a result in its own hub", async () => {
    const { noEmail } = ids();
    await browser.url(`/search?q=${encodeURIComponent(`No email ${browser.capabilities.browserName}`)}`);
    const result = $(`.search-results li[data-id="${noEmail}"] a`);
    await expect(result).toHaveAttribute("href", `${CL_INBOX}/${noEmail}`);
    await expect(result).toHaveText(expect.stringContaining("Climbing Logbook"));
    await result.click();
    await expect($(".item-title")).toHaveText(`No email ${browser.capabilities.browserName}`);
    await expect($(".hub-tabs [aria-current=page]")).toHaveText("Inbox");
  });

  it("switches product from the top bar", async () => {
    await browser.url("/climbing-logbook");
    await expect($("h1")).toHaveText("Climbing Logbook");
    await $(".switcher summary").click();
    await $(".switcher").$("a=Deaftly").click();
    await expect($("h1")).toHaveText("Deaftly");
    expect(new URL(await browser.getUrl()).pathname).toBe("/deaftly");
  });

  it("shows not found for a product nobody has", async () => {
    await browser.url("/no-such-product");
    await expect($("h1")).toHaveText("Not found");
  });

  it("marks an item read when it is opened", async () => {
    const { unread } = ids();
    const search = encodeURIComponent(`Unread subject ${browser.capabilities.browserName}`);
    await browser.url(`${CL_INBOX}?q=${search}`);
    await expect(row(unread)).toHaveAttribute("data-unread", "true");
    await row(unread).$("a").click();
    await expect($(".item-title")).toHaveText(`Unread subject ${browser.capabilities.browserName}`);
    await browser.waitUntil(async () => (await row(unread).getAttribute("data-unread")) === null);
    await browser.url(`${CL_INBOX}?state=new&q=${search}`);
    await listLoaded();
    await expect(row(unread)).not.toBeExisting();
  });
});

describe("item", () => {
  it("renders hostile message text literally, and fences it in the issue draft", async () => {
    await openItem(ids().hostile);
    await expect($(".message-body")).toHaveText(HOSTILE_MESSAGE);
    expect(await browser.execute(() => document.querySelectorAll(".message-body img, .message-body b").length)).toBe(0);
    await toolbarButton("Create GitHub issue").click();
    await browser.waitUntil(async () => (await $("#draft-body").getValue()).length > 0);
    const body = await $("#draft-body").getValue();
    expect(body.startsWith("````text\n<img src=x onerror=alert(1)>")).toBe(true);
    expect(body).toContain("\n````\n");
  });

  it("disables replying, with the reason, when there is no contact email", async () => {
    await openItem(ids().noEmail);
    await expect(toolbarButton("Reply")).toBeDisabled();
    await expect($("#reason-reply")).toHaveText("No contact email.");
  });

  it("sends a reply and appends it to the thread", async () => {
    await openItem(ids().reply);
    await toolbarButton("Reply").click();
    await $("#reply-text").setValue("Yes: Settings, then Export.");
    await $("button=Send reply").click();
    await expect($$(".message")).toBeElementsArrayOfSize(2);
    await expect($(".message.out .message-body")).toHaveText("Yes: Settings, then Export.");
    await expect($('[aria-label="Reply"]')).not.toBeDisplayed();
    await expect(toolbarButton("Reply")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows why a reply failed, and keeps what was typed", async () => {
    const replies = await browser.mock("**/api/items/*/replies", { method: "post" });
    replies.respond({ error: "send-failed" }, { statusCode: 502, fetchResponse: false });
    await openItem(ids().email);
    await toolbarButton("Reply").click();
    await $("#reply-text").setValue("Yes, it does.");
    await $("button=Send reply").click();
    await expect($('[aria-label="Reply"] [role=alert]')).toHaveText(
      "Couldn't send the reply, and nothing was sent: try again in a minute.",
    );
    await expect($("#reply-text")).toHaveValue("Yes, it does.");
    await expect($$(".message")).toBeElementsArrayOfSize(1);
    await browser.mockRestoreAll();
  });

  it("opens an editable issue draft, and says when GitHub can't be reached", async () => {
    await openItem(ids().email);
    await toolbarButton("Create GitHub issue").click();
    await browser.waitUntil(
      async () => (await $("#draft-title").isExisting()) && (await $("#draft-title").getValue()) !== "",
    );
    await expect($("#draft-repo")).toHaveValue("oneloneraven/deaftly");
    await expect($("#draft-body")).toHaveValue(expect.stringContaining("Does it work with captions turned off?"));
    await $("#draft-title").setValue("Captions off");
    await $("button=Create issue").click();
    await expect($('[aria-label="GitHub issue draft"] [role=alert]')).toHaveText(
      "Couldn't create the issue: GitHub isn't connected on this server yet.",
    );
    await expect($("#draft-title")).toHaveValue("Captions off");
    await expect(toolbarButton("Create GitHub issue")).toBeExisting();
  });

  it("shows the formatted version only on request, in a sandbox that runs nothing", async () => {
    const page = await browser.url(`/items/${ids().email}`);
    await $(".item-title").waitForExist();
    await expect($(".formatted iframe")).not.toBeExisting();
    await $("button=Show formatted").click();
    await expect($(".formatted iframe")).toHaveAttribute("sandbox", "");
    await expect($(".formatted figcaption")).toHaveText("Formatted view");
    const formatted = await page.frame({ selector: ".formatted iframe" });
    await expect(formatted.$("#formatted")).toHaveText("Formatted hello");
    await expect(formatted.$("#ran")).not.toBeExisting();
    await toolbarButton("Star").click();
    await browser.waitUntil(async () => (await toolbarButton("Star").getAttribute("aria-pressed")) === "true");
    await expect(formatted.$("#formatted")).toHaveText("Formatted hello");
    await $("button=Hide formatted").click();
    await expect($(".formatted iframe")).not.toBeExisting();
  });

  it("links to the GitHub issue once there is one", async () => {
    await openItem(ids().linked);
    const link = $(".toolbar").$("a=View GitHub issue #7");
    await expect(link).toHaveAttribute("href", ISSUE_URL);
    await expect(toolbarButton("Create GitHub issue")).not.toBeExisting();
  });

  it("collapses the opener when a panel is cancelled", async () => {
    await openItem(ids().email);
    await toolbarButton("Reply").click();
    await expect(toolbarButton("Reply")).toHaveAttribute("aria-expanded", "true");
    await $('[aria-label="Reply"]').$("button=Cancel").click();
    await expect($('[aria-label="Reply"]')).not.toBeDisplayed();
    await expect(toolbarButton("Reply")).toHaveAttribute("aria-expanded", "false");
  });

  it("disables quoting, with the reason, when there is no consent", async () => {
    await openItem(ids().noEmail);
    await expect(toolbarButton("Quote")).toBeDisabled();
    await expect($("#reason-quote")).toHaveText("No consent to quote.");
  });

  it("saves a selected quote and approves it", async () => {
    await openItem(ids().consent);
    await toolbarButton("Quote").click();
    await expect($("button=Save quote")).toBeDisabled();
    await browser.execute(() => {
      const body = document.querySelector(".message.in .message-body");
      if (body) window.getSelection()?.selectAllChildren(body);
    });
    await browser.waitUntil(async () => (await $("button=Save quote").isEnabled()) === true);
    await $("button=Save quote").click();
    const quote = $(".quote");
    await quote.waitForExist();
    await expect(quote.$("blockquote")).toHaveText(CONSENT_MESSAGE);
    await expect(quote).toHaveAttribute("data-status", "waiting");
    await quote.$("button=Approve").click();
    await browser.waitUntil(async () => (await $(".quote").getAttribute("data-status")) === "approved");
    await expect($(".quote .quote-status")).toHaveText("Approved");
  });

  it("stars and keeps the star", async () => {
    await openItem(ids().star);
    await toolbarButton("Star").click();
    await browser.waitUntil(async () => (await toolbarButton("Star").getAttribute("aria-pressed")) === "true");
    await browser.refresh();
    await $(".item-title").waitForExist();
    await expect(toolbarButton("Star")).toHaveAttribute("aria-pressed", "true");
  });

  it("archives and unarchives, and the row leaves the active list", async () => {
    const { archive } = ids();
    await openItem(archive);
    await listLoaded();
    await expect(row(archive)).toBeExisting();
    await toolbarButton("Archive").click();
    await $("button=Unarchive").waitForExist();
    await browser.waitUntil(async () => !(await row(archive).isExisting()));
    await $("button=Unarchive").click();
    await $("button=Archive").waitForExist();
    await browser.waitUntil(async () => row(archive).isExisting());
  });

  it("deletes only after the inline confirmation", async () => {
    const { remove } = ids();
    await openItem(remove);
    await toolbarButton("Delete").click();
    await expect($(".confirm")).toHaveText(expect.stringContaining("Delete this and its quotes for good?"));
    await $("button=Keep it").click();
    await expect($(".confirm")).not.toBeExisting();
    await toolbarButton("Delete").click();
    await $("button=Delete for good").click();
    await browser.waitUntil(async () => new URL(await browser.getUrl()).pathname === CL_INBOX);
    await expect(row(remove)).not.toBeExisting();
    await expect($(".item-title")).not.toBeExisting();
    await expect($(".split")).not.toHaveElementClass("has-item");
    await expect($(".detail-pane .empty")).toBeExisting();
    const status = await browser.execute(async id => (await fetch(`/api/items/${id}`)).status, remove);
    expect(status).toBe(404);
  });
});

describe("junk", () => {
  it("lists junk and moves an item back", async () => {
    const { junk } = ids();
    await browser.url(CL_INBOX);
    await listLoaded();
    await $(".filter-chips").$("button=Junk").click();
    await expect($(".hub-body h2")).toHaveText("Junk");
    await expect(row(junk)).toBeExisting();
    await expect($("button=Show more")).not.toBeDisplayed();
    await row(junk).$("button=Not junk").click();
    await browser.waitUntil(async () => !(await row(junk).isExisting()));
    await browser.url(`${CL_INBOX}?q=${encodeURIComponent(`Cheap pills ${browser.capabilities.browserName}`)}`);
    await expect(row(junk)).toBeExisting();
  });
});
