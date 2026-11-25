import { expect, test } from "vitest";
import { betaText, changeText, healthWord, hubSummary, verdict } from "../src/ui/format.js";

test("unhealthy products count towards the verdict", () => {
  expect(verdict({ healthFailing: 1 })).toBe("1 thing needs you.");
  expect(verdict({ healthFailing: 1, replyOwed: 1, releasesWaiting: 1 })).toBe("3 things need you.");
  expect(verdict({})).toBe("All clear.");
});

test("the hub summary says who needs you, then who's quiet", () => {
  expect(
    hubSummary([
      { name: "Climbing Logbook", needs: 3 },
      { name: "Deaftly", needs: 1 },
      { name: "Beyond Borders", needs: 0 },
    ]),
  ).toBe("Climbing Logbook has 3 and Deaftly has 1. Beyond Borders is quiet.");
  expect(hubSummary([{ name: "Climbing Logbook", needs: 2 }])).toBe("Climbing Logbook has 2.");
  expect(
    hubSummary([
      { name: "Climbing Logbook", needs: 1 },
      { name: "Deaftly", needs: 0 },
      { name: "Beyond Borders", needs: 0 },
    ]),
  ).toBe("Climbing Logbook has 1. Deaftly and Beyond Borders are quiet.");
  expect(hubSummary([{ name: "Deaftly", needs: 0 }])).toBe("");
});

test("health words", () => {
  expect(["healthy", "degraded", "failing", "unmonitored", "unknown", "odd"].map(healthWord)).toEqual([
    "Healthy",
    "Degraded",
    "Failing",
    "Not monitored",
    "Unknown",
    "Unknown",
  ]);
});

test("the change on last month", () => {
  expect(changeText(12)).toBe("Up 12% on last month");
  expect(changeText(-4)).toBe("Down 4% on last month");
  expect(changeText(0)).toBe("Same as last month");
  expect(changeText(null)).toBe("");
});

test("the beta badge says how far ahead beta is", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  expect(betaText({ version: "v1.15.0", since: "2026-11-22T11:00:00Z" }, now)).toBe(
    "Beta v1.15.0, 3 days ahead of production",
  );
});
