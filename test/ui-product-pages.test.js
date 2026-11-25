import { expect, test } from "vitest";
import { FOUNDATION, pagesFor } from "../src/ui/products/pages.js";

const mount = () => ({ update() {}, destroy() {} });
const titles = (/** @type {{ title: string }[]} */ pages) => pages.map(page => page.title);

test("a product with no pages of its own has only the foundation tabs", () => {
  expect(pagesFor("deaftly", {})).toEqual(FOUNDATION);
  expect(pagesFor("deaftly", { "climbing-logbook": [{ path: "climbs", title: "Climbs", mount }] })).toEqual(FOUNDATION);
});

test("a product's own pages follow the foundation pages, in the order registered", () => {
  const pages = pagesFor("climbing-logbook", {
    "climbing-logbook": [
      { path: "climbs", title: "Climbs", mount },
      { path: "places", title: "Places", mount },
    ],
  });
  expect(titles(pages)).toEqual(["Overview", "Inbox", "Releases", "Health", "Usage", "Climbs", "Places"]);
  expect(pages.at(-2)).toEqual({ id: "climbs", title: "Climbs", mount });
});

test("an own page can't shadow a foundation page, repeat another, or have a path that isn't a plain segment", () => {
  const pages = pagesFor("climbing-logbook", {
    "climbing-logbook": [
      { path: "inbox", title: "My inbox", mount },
      { path: "", title: "My overview", mount },
      { path: "climbs", title: "Climbs", mount },
      { path: "climbs", title: "Climbs again", mount },
      { path: "a/b", title: "Nested", mount },
      { path: "Upper", title: "Upper", mount },
    ],
  });
  expect(titles(pages)).toEqual(["Overview", "Inbox", "Releases", "Health", "Usage", "Climbs"]);
  expect(pages.find(page => page.id === "inbox")?.mount).toBeUndefined();
});

test("a route that's an Object property name isn't a product", () => {
  expect(pagesFor("constructor", {})).toEqual(FOUNDATION);
});
