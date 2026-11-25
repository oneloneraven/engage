import { env as baseEnv } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { counts } from "../src/admin/items.js";
import { readConformance } from "../src/conformance/read.js";
import worker from "../src/worker.js";
import { makeCtx, makeEnv } from "./helpers.js";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const FRESH = "2026-11-26T03:20:00.000Z";
const OLD = "2026-11-24T03:20:00.000Z";

/** @param {string} repo @param {string} checkId @param {string} status @param {string} [at] */
const cell = (repo, checkId, status, at = FRESH) =>
  baseEnv.DB.prepare(
    "INSERT INTO conformance_results (repo, check_id, status, reason, link, checked_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(
    repo,
    checkId,
    status,
    status === "fail" ? `${checkId} failed` : "",
    status === "fail" ? "https://github.com/x" : null,
    at,
  );

beforeEach(async () => {
  for (const table of ["conformance_results", "conformance_checks", "conformance_runs"])
    await baseEnv.DB.exec(`DELETE FROM ${table}`);
  await baseEnv.DB.batch([
    baseEnv.DB.prepare(
      "INSERT INTO conformance_checks (id, title, position) VALUES ('ruleset', 'Default branch ruleset', 0), ('labels', 'Labels', 1)",
    ),
    baseEnv.DB.prepare(
      "INSERT INTO conformance_runs (started_at, finished_at, rules_version, complete, error) VALUES (?, ?, 1, 1, NULL)",
    ).bind(FRESH, FRESH),
    cell("oneloneraven/engage", "ruleset", "fail"),
    cell("oneloneraven/engage", "labels", "fail"),
    cell("oneloneraven/project-bootstrap", "ruleset", "pass"),
    cell("oneloneraven/project-bootstrap", "labels", "unknown"),
    cell("oneloneraven/deaftly-website", "ruleset", "fail", OLD),
    cell("oneloneraven/deaftly-website", "labels", "pass", OLD),
    cell("oneloneraven/climbing-logbook", "ruleset", "pass"),
    cell("oneloneraven/climbing-logbook", "labels", "skipped"),
  ]);
});

test("results are grouped by product in registry order, then repositories with no product", async () => {
  const result = await readConformance(makeEnv(), NOW);
  expect(result.checks).toEqual([
    { id: "ruleset", title: "Default branch ruleset" },
    { id: "labels", title: "Labels" },
  ]);
  expect(result.repositories.map(r => [r.name, r.product, r.failing, r.stale])).toEqual([
    ["climbing-logbook", "cl", 0, false],
    ["deaftly-website", "deaftly", 1, true],
    ["engage", null, 2, false],
    ["project-bootstrap", null, 0, false],
  ]);
  expect(result.repositories[2].cells.ruleset).toEqual({
    status: "fail",
    reason: "ruleset failed",
    link: "https://github.com/x",
  });
  expect(result.lastRun).toEqual({ finishedAt: FRESH, rulesVersion: 1, stale: false });
});

test("a failed latest run is reported beside the last complete one", async () => {
  await baseEnv.DB.prepare(
    "INSERT INTO conformance_runs (started_at, finished_at, complete, error) VALUES (?, ?, 0, 'rules-unavailable')",
  )
    .bind(NOW.toISOString(), NOW.toISOString())
    .run();
  const result = await readConformance(makeEnv(), NOW);
  expect(result.lastRun?.finishedAt).toBe(FRESH);
  expect(result.lastError).toEqual({ at: NOW.toISOString(), error: "rules-unavailable" });
});

test("counts put each failing repository once on its owner's card, or with no product", async () => {
  const result = await counts(makeEnv(), NOW);
  expect(result.repositoriesFailing).toBe(2);
  expect(result.byProduct.deaftly.repositoriesFailing).toEqual([
    { repo: "oneloneraven/deaftly-website", name: "deaftly-website", failing: 1, stale: true },
  ]);
  expect(result.byProduct.cl.repositoriesFailing).toEqual([]);
  expect(result.noProductRepositoriesFailing).toEqual([
    { repo: "oneloneraven/engage", name: "engage", failing: 2, stale: false },
  ]);
});

test("GET /api/repositories serves the grid", async () => {
  const env = makeEnv({
    APP_ENV: "e2e",
    ADMIN_HOST: "localhost",
    ADMIN_ACCESS_CHECK: "off",
    ASSETS: { fetch: async () => new Response("asset") },
  });
  const ctx = makeCtx();
  const response = await worker.fetch(new Request("https://localhost/api/repositories"), env, ctx);
  await ctx.settled();
  expect(response.status).toBe(200);
  expect((await response.json()).repositories).toHaveLength(4);
});
