import { $, $$, browser, expect } from "@wdio/globals";
import { CONSENT_MESSAGE, HOSTILE_MESSAGE, SHARED_OWED, idsFor } from "./fixtures.js";

const ids = () => idsFor(String(browser.capabilities.browserName));
const row = id => $(`li[data-id="${id}"]`);

async function listLoaded() {
  await browser.waitUntil(async () => (await $$("ul.rows li")).length > 0 || (await $$(".empty")).length > 0);
}

async function openItem(id) {
  await browser.url(`/items/${id}`);
  await $("h1.item-title").waitForExist();
}

const toolbarButton = name => $(".toolbar").$(`button=${name}`);

describe("home", () => {
  it("says what needs you, from the real data", async () => {
    await browser.url("/");
    await expect($("h1")).toHaveText("1 thing needs you.");
    const needsRow = $(`a[href="/items/${SHARED_OWED}"]`);
    await expect(needsRow).toHaveText(expect.stringContaining("The map is blank"));
    await expect(needsRow).toHaveText(expect.stringContaining("Climbing Logbook"));
  });

  it("says all green when nothing is owed", async () => {
    await browser.mock("**/api/counts").then(mock => mock.respond({ new: 0, open: 0, replyOwed: 0, byProduct: {} }));
    await browser.mock("**/api/items*").then(mock => mock.respond({ items: [], next: null }));
    await browser.url("/");
    await expect($("h1")).toHaveText("All green.");
    await expect($("section[aria-labelledby=needs-you] .empty")).toHaveText(
      "Nothing needs you. New feedback lands here and pings Discord.",
    );
    await browser.mockRestoreAll();
  });

  it("shows the plural verdict, linked counts and a card per product", async () => {
    await browser.mock("**/api/counts").then(mock =>
      mock.respond({
        new: 3,
        open: 5,
        replyOwed: 2,
        byProduct: { cl: { new: 2, open: 3 }, deaftly: { new: 1, open: 2 } },
      }),
    );
    await browser.url("/");
    await expect($("h1")).toHaveText("2 things need you.");
    for (const [label, state, count] of [
      ["New", "new", "3"],
      ["Open", "open", "5"],
      ["Reply owed", "reply-owed", "2"],
    ]) {
      const link = $(`.counts a[href="/inbox?state=${state}"]`);
      await expect(link).toHaveText(expect.stringContaining(label));
      await expect(link).toHaveText(expect.stringContaining(count));
    }
    await expect($('a[data-product="cl"]')).toHaveText(expect.stringContaining("Climbing Logbook"));
    await expect($('a[data-product="cl"]')).toHaveText(expect.stringContaining("2 new · 3 open"));
    await expect($('a[data-product="deaftly"]')).toHaveText(expect.stringContaining("1 new · 2 open"));
    await browser.mockRestoreAll();
  });
});

describe("inbox", () => {
  it("filters by search text, and keeps the filter across a reload", async () => {
    const { unread, star } = ids();
    await browser.url("/inbox");
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

  it("filters by product, kind and state", async () => {
    const { consent, email, hostile } = ids();
    await browser.url("/inbox");
    await listLoaded();
    await $("#filter-product").selectByAttribute("value", "deaftly");
    await browser.waitUntil(async () => !(await row(hostile).isExisting()));
    await expect(row(consent)).toBeExisting();
    await expect(row(email)).toBeExisting();
    await $("#filter-kind").selectByAttribute("value", "email");
    await browser.waitUntil(async () => !(await row(consent).isExisting()));
    await expect(row(email)).toBeExisting();
    await $("#filter-product").selectByAttribute("value", "");
    await $("#filter-kind").selectByAttribute("value", "");
    await $("#filter-state").selectByAttribute("value", "reply-owed");
    await browser.waitUntil(async () => !(await row(email).isExisting()));
    await expect(row(SHARED_OWED)).toBeExisting();
    expect(await browser.getUrl()).toContain("state=reply-owed");
  });

  it("marks an item read when it is opened", async () => {
    const { unread } = ids();
    const search = encodeURIComponent(`Unread subject ${browser.capabilities.browserName}`);
    await browser.url(`/inbox?q=${search}`);
    await expect(row(unread)).toHaveAttribute("data-unread", "true");
    await row(unread).$("a").click();
    await expect($("h1.item-title")).toHaveText(`Unread subject ${browser.capabilities.browserName}`);
    await browser.waitUntil(async () => (await row(unread).getAttribute("data-unread")) === null);
    await browser.url(`/inbox?state=new&q=${search}`);
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
    await expect($("#reason-reply")).toHaveText("No contact email");
  });

  it("shows why a reply failed, and keeps what was typed", async () => {
    await openItem(ids().email);
    await toolbarButton("Reply").click();
    await $("#reply-text").setValue("Yes, it does.");
    await $("button=Send reply").click();
    await expect($('[aria-label="Reply"] [role=alert]')).toHaveText(
      "Couldn't send: reply addresses aren't set up on this server yet.",
    );
    await expect($("#reply-text")).toHaveValue("Yes, it does.");
    await expect($$(".message")).toBeElementsArrayOfSize(1);
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

  it("disables quoting, with the reason, when there is no consent", async () => {
    await openItem(ids().noEmail);
    await expect(toolbarButton("Quote")).toBeDisabled();
    await expect($("#reason-quote")).toHaveText("No consent to quote");
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
    await $("h1.item-title").waitForExist();
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
    await browser.waitUntil(async () => new URL(await browser.getUrl()).pathname === "/inbox");
    await expect(row(remove)).not.toBeExisting();
    const status = await browser.execute(async id => (await fetch(`/api/items/${id}`)).status, remove);
    expect(status).toBe(404);
  });
});

describe("junk", () => {
  it("lists junk and moves an item back", async () => {
    const { junk } = ids();
    await browser.url("/junk");
    await expect(row(junk)).toBeExisting();
    await row(junk).$("button=Not junk").click();
    await browser.waitUntil(async () => !(await row(junk).isExisting()));
    await browser.url(`/inbox?q=${encodeURIComponent(`Cheap pills ${browser.capabilities.browserName}`)}`);
    await expect(row(junk)).toBeExisting();
  });
});
