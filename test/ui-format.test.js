import { expect, test } from "vitest";
import {
  betaText,
  cellWord,
  driftSummary,
  changeText,
  checksFailing,
  healthWord,
  hubSummary,
  verdict,
} from "../src/ui/format.js";

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

test("failing repositories count towards the verdict, once each", () => {
  expect(verdict({ repositoriesFailing: 2 })).toBe("2 things need you.");
  expect(verdict({ repositoriesFailing: 1, replyOwed: 1 })).toBe("2 things need you.");
});

test("cells and failing checks are named in words", () => {
  expect(cellWord("n/a")).toBe("Doesn't apply");
  expect(cellWord("fail")).toBe("Fail");
  expect(cellWord("other")).toBe("Unknown");
  expect(checksFailing(1)).toBe("1 check failing");
  expect(checksFailing(3)).toBe("3 checks failing");
});

test("drifted repositories outside a product get their own sentence", () => {
  expect(driftSummary([])).toBe("");
  expect(driftSummary(["engage"])).toBe("engage has drifted from bootstrap.");
  expect(driftSummary(["engage", "project-bootstrap"])).toBe(
    "engage and project-bootstrap have drifted from bootstrap.",
  );
});
