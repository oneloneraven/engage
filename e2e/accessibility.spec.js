import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { $, browser, expect } from "@wdio/globals";
import { SHARED_RELEASE, idsFor } from "./fixtures.js";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const PAGES = [
  { name: "Home", path: () => "/", ready: "h1.verdict" },
  { name: "Product overview", path: () => "/climbing-logbook", ready: ".hub-card" },
  { name: "Inbox", path: () => "/climbing-logbook/inbox", ready: "ul.rows li:first-child" },
  {
    name: "Inbox filtered to nothing",
    path: () => "/climbing-logbook/inbox?q=no-such-message",
    ready: ".status .empty",
  },
  { name: "Item", path: ids => `/items/${ids.hostile}`, ready: ".item-title" },
  { name: "Item with consent", path: ids => `/items/${ids.consent}`, ready: ".item-title" },
  { name: "Junk", path: () => "/climbing-logbook/inbox?state=junk", ready: "ul.rows li:first-child" },
  { name: "Search", path: () => "/search?q=export", ready: ".search-results li:first-child" },
  { name: "Releases", path: () => "/climbing-logbook/releases", ready: "ul.rows li:first-child" },
  { name: "Release", path: () => `/climbing-logbook/releases/${SHARED_RELEASE}`, ready: "h2.item-title" },
  { name: "Health", path: () => "/climbing-logbook/health", ready: ".monitors li" },
  { name: "Usage", path: () => "/climbing-logbook/usage", ready: ".usage svg.sparkline" },
  { name: "Health not set up", path: () => "/deaftly/health", ready: ".setup-state" },
  { name: "Climbs not set up", path: () => "/climbing-logbook/climbs", ready: ".setup-state" },
  { name: "Repositories", path: () => "/repositories", ready: ".run-line" },
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

const WIDTHS = [
  { label: "phone", width: 375, height: 812 },
  { label: "desktop", width: 1280, height: 900 },
];

for (const colorScheme of ["light", "dark"])
  for (const { label, width, height } of WIDTHS) {
    describe(`${colorScheme} theme at ${label} width`, () => {
      before(async () => {
        await browser.setViewport({ width, height });
        await browser.emulate("colorScheme", colorScheme);
      });

      for (const { name, path, ready } of PAGES) {
        it(`${name} has no WCAG 2.2 AA violations`, async () => {
          await browser.url(path(idsFor(String(browser.capabilities.browserName))));
          await $(ready).waitForExist();
          expect(await violations()).toEqual([]);
        });
      }

      it("the item page has none with the reply composer, issue draft and formatted view open", async () => {
        const ids = idsFor(String(browser.capabilities.browserName));
        await browser.url(`/items/${ids.email}`);
        await $(".item-title").waitForExist();
        await $(".toolbar").$("button=Reply").click();
        expect(await violations()).toEqual([]);
        await $(".toolbar").$("button=Create GitHub issue").click();
        await $("#draft-title").waitForExist();
        expect(await violations()).toEqual([]);
        await $("button=Show formatted").click();
        await $(".formatted iframe").waitForExist();
        expect(await violations()).toEqual([]);
      });
    });
  }
