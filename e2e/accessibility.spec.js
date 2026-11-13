import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { browser, expect } from "@wdio/globals";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PAGES = ["/"];
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

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

    for (const path of PAGES) {
      it(`${path} has no WCAG 2.2 AA violations`, async () => {
        await browser.url(path);
        expect(await violations()).toEqual([]);
      });
    }
  });
}
