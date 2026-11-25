import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import { gatedRepo } from "../src/releases/registry.js";
import { createRelease, decideRelease, getRelease, listReleases, spendRelease } from "../src/releases/store.js";

const base = {
  repo: "oneloneraven/climbing-logbook",
  product: "cl",
  environment: "production",
  sha: "abc123",
  ref: "v1.14.0",
  runId: 42,
  callbackUrl: "https://api.github.com/repos/oneloneraven/climbing-logbook/actions/runs/42/deployment_protection_rule",
  installationId: 7,
};

const audits = async () =>
  (await env.DB.prepare("SELECT action, target_type FROM audit_events WHERE target_type = 'release' ORDER BY id").all())
    .results;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM releases");
  await env.DB.exec("DELETE FROM audit_events");
});

test("the registry knows each gated repository, case-insensitively, and nothing else", async () => {
  expect(await gatedRepo(env, "OneLoneRaven/Climbing-Logbook")).toEqual({
    repo: "oneloneraven/climbing-logbook",
    product: "cl",
    environments: ["production", "infra"],
    tokenPolicy: {},
  });
  expect((await gatedRepo(env, "oneloneraven/deaftly"))?.environments).toEqual(["release"]);
  expect(await gatedRepo(env, "someone/else")).toBeNull();
});

test("a redelivered request while the first is pending stores one release", async () => {
  const first = await createRelease(env, base);
  const second = await createRelease(env, base);
  expect(first.created).toBe(true);
  expect(second).toEqual({ id: first.id, created: false });
  const [release] = await listReleases(env, { state: "pending" });
  expect(release).toMatchObject({ id: first.id, productName: "Climbing Logbook", runId: 42, state: "pending" });
  expect(await listReleases(env)).toHaveLength(1);
});

test("a re-run after a rejection asks again with a new pending release", async () => {
  const first = await createRelease(env, base);
  await decideRelease(env, first.id, "rejected", "owner@example.test");
  const again = await createRelease(env, base);
  expect(again.created).toBe(true);
  expect(again.id).not.toBe(first.id);
});

test("only a pending release can be decided, and every decision is audited", async () => {
  const { id } = await createRelease(env, base);
  const approved = await decideRelease(env, id, "approved", "owner@example.test", "Looks good");
  expect(approved).toMatchObject({ state: "approved", note: "Looks good", decidedBy: "owner@example.test" });
  await expect(decideRelease(env, id, "rejected", "owner@example.test")).rejects.toThrow("release-not-pending");
  const other = await createRelease(env, { ...base, environment: "infra" });
  await decideRelease(env, other.id, "expired", "github");
  expect(await audits()).toEqual([
    { action: "release.approved", target_type: "release" },
    { action: "release.expired", target_type: "release" },
  ]);
});

test("an approved release is spent once, and only by an exact match", async () => {
  const { id } = await createRelease(env, base);
  const match = { repo: base.repo, environment: "production", sha: "abc123", runId: 42 };
  expect(await spendRelease(env, match)).toBeNull();
  await decideRelease(env, id, "approved", "owner@example.test");
  for (const wrong of [
    { ...match, sha: "other" },
    { ...match, environment: "infra" },
    { ...match, runId: 43 },
    { ...match, repo: "oneloneraven/deaftly" },
  ])
    expect(await spendRelease(env, wrong)).toBeNull();
  const spent = await spendRelease(env, match);
  expect(spent).toMatchObject({ id, state: "spent" });
  expect(spent?.spentAt).not.toBeNull();
  expect(await spendRelease(env, match)).toBeNull();
  expect((await getRelease(env, id))?.state).toBe("spent");
});
