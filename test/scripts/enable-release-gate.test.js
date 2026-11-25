import { expect, test } from "vitest";
import { plan } from "../../scripts/enable-release-gate.mjs";

test("plans a rule for each gated environment that doesn't already use Engage's App", () => {
  const gated = [
    { repo: "oneloneraven/climbing-logbook", environments: ["production", "infra"] },
    { repo: "oneloneraven/deaftly", environments: ["release", "beta"] },
  ];
  const current = {
    "oneloneraven/climbing-logbook:production": { exists: true, appIds: [] },
    "oneloneraven/climbing-logbook:infra": { exists: true, appIds: [99, 42] },
    "oneloneraven/deaftly:release": { exists: true, appIds: [99] },
  };
  expect(plan(gated, current, 42)).toEqual([
    { repo: "oneloneraven/climbing-logbook", environment: "production", action: "add-rule" },
    { repo: "oneloneraven/climbing-logbook", environment: "infra", action: "already-gated" },
    { repo: "oneloneraven/deaftly", environment: "release", action: "add-rule" },
    { repo: "oneloneraven/deaftly", environment: "beta", action: "missing-environment" },
  ]);
});
