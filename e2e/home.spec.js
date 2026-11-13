import { $, browser, expect } from "@wdio/globals";

describe("home page @safari", () => {
  it("greets", async () => {
    await browser.url("/");
    await expect($("h1")).toHaveText("Hello from Engage");
  });
});
