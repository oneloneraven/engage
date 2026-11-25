import { expect, test } from "vitest";
import { betaText, changeText, healthWord, verdict, verdictSummary } from "../src/ui/format.js";

test("unhealthy products count towards the verdict", () => {
  expect(verdict({ healthFailing: 1 })).toBe("1 thing needs you.");
  expect(verdict({ healthFailing: 1, replyOwed: 1, releasesWaiting: 1 })).toBe("3 things need you.");
  expect(verdict({})).toBe("All clear.");
});

test("the summary names one unhealthy product, and counts several", () => {
  expect(verdictSummary({ unhealthy: [{ name: "Climbing Logbook", status: "failing" }] })).toBe(
    "Climbing Logbook is failing. Everything else is quiet.",
  );
  expect(
    verdictSummary({
      unhealthy: [
        { name: "Climbing Logbook", status: "failing" },
        { name: "Deaftly", status: "degraded" },
      ],
      releasesWaiting: 1,
      replyOwed: 2,
    }),
  ).toBe("2 products need a look, a release is waiting and 2 people are owed a reply. Everything else is quiet.");
  expect(verdictSummary({ releasesWaiting: 1, replyOwed: 1 })).toBe(
    "A release is waiting and someone is owed a reply. Everything else is quiet.",
  );
  expect(verdictSummary({})).toBe("");
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
