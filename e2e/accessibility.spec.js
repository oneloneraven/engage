import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { $, browser, expect } from "@wdio/globals";
import { idsFor } from "./fixtures.js";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const PAGES = [
  { name: "Home", path: () => "/", ready: "h1.verdict" },
  { name: "Inbox", path: () => "/inbox", ready: "ul.rows li:first-child" },
  { name: "Inbox filtered to nothing", path: () => "/inbox?q=no-such-message", ready: ".status .empty" },
  { name: "Item", path: ids => `/items/${ids.hostile}`, ready: "h1.item-title" },
  { name: "Item with consent", path: ids => `/items/${ids.consent}`, ready: "h1.item-title" },
  { name: "Junk", path: () => "/junk", ready: "ul.rows li:first-child" },
  { name: "Not found", path: () => "/no-such-page", ready: "h1.page-title" },
];

async function violations() {
  await browser.execute(axeSource);
  const result = await browser.execute(
    tags => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
    WCAG_22_AA,
  );
  return result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(", ")}`);
}

for (const colorScheme of ["light", "dark"]) {
  describe(`${colorScheme} theme at phone width @safari`, () => {
    before(async function () {
      if (!browser.isBidi) {
        // Safari speaks classic WebDriver only, which can't emulate a colour scheme or set the viewport.
        if (colorScheme === "dark") this.skip();
        await browser.setWindowSize(375, 812);
        return;
      }
      await browser.setViewport({ width: 375, height: 812 });
      await browser.emulate("colorScheme", colorScheme);
    });

    for (const { name, path, ready } of PAGES) {
      it(`${name} has no WCAG 2.2 AA violations`, async () => {
        await browser.url(path(idsFor(String(browser.capabilities.browserName))));
        await $(ready).waitForExist();
        expect(await violations()).toEqual([]);
      });
    }

    it("the item page has none with the reply composer and issue draft open", async () => {
      const ids = idsFor(String(browser.capabilities.browserName));
      await browser.url(`/items/${ids.email}`);
      await $("h1.item-title").waitForExist();
      await $(".toolbar").$("button=Reply").click();
      expect(await violations()).toEqual([]);
      await $(".toolbar").$("button=Create GitHub issue").click();
      await $("#draft-title").waitForExist();
      expect(await violations()).toEqual([]);
    });
  });
}
