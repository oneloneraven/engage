import { afterEach, expect, test, vi } from "vitest";
import { reader } from "../src/conformance/github.js";
import { KINDS } from "../src/conformance/kinds.js";
import { stubGithub } from "./github-stub.js";

const REPO = "oneloneraven/engage";
const R = `/repos/${REPO}`;
const ENGAGE_APP = 123;

/** @type {any} */
const RECORD = {
  modules: ["core", "web-app"],
  skipped: {},
  answers: { private: false },
  ruleset: {
    rules: [
      { type: "deletion" },
      { type: "pull_request", parameters: { allowed_merge_methods: ["squash"], required_approving_review_count: 0 } },
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "test" }] } },
    ],
  },
  settings: { allow_merge_commit: false, security_and_analysis: { secret_scanning: { status: "enabled" } } },
  labels: [{ name: "release: none" }, { name: "release: minor" }],
};
/** @type {any} */
const RULES = {
  version: 1,
  checks: [],
  requiredChecks: { core: ["check-label"], "web-app": ["e2e", { context: "e2e-safari", when: "!private" }] },
};

/**
 * @param {string} kind
 * @param {Record<string, unknown>} [check]
 * @param {Record<string, unknown>} [extra]
 */
const run = (kind, check = {}, extra = {}) =>
  KINDS[kind]({
    read: reader("t"),
    repo: REPO,
    defaultBranch: "main",
    record: RECORD,
    check: /** @type {any} */ ({ id: kind, title: kind, kind, modules: ["core"], ...check }),
    rules: RULES,
    gated: null,
    engageAppId: ENGAGE_APP,
    ...extra,
  });

/** @param {Record<string, unknown>} overrides */
const liveRuleset = (overrides = {}) => ({
  id: 7,
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion", ruleset_id: 7 },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        allowed_merge_methods: ["squash"],
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: ["test", "check-label", "e2e", "e2e-safari"].map(context => ({
          context,
          integration_id: 15368,
        })),
      },
    },
  ],
  ...overrides,
});

/** @param {any} ruleset */
const rulesetRoutes = ruleset => ({
  [`${R}/rulesets?includes_parents=true&per_page=100`]: [{ id: 7, target: "branch", enforcement: ruleset.enforcement }],
  [`${R}/rulesets/7`]: ruleset,
});

afterEach(() => vi.restoreAllMocks());

test("record-present fails without a record or its GitHub part", async () => {
  expect(await run("record-present")).toMatchObject({ status: "pass" });
  expect(await run("record-present", {}, { record: null })).toMatchObject({
    status: "fail",
    reason: "Bootstrap hasn't set this repository up",
  });
  expect(
    await run("record-present", {}, { record: { ...RECORD, ruleset: null, settings: null, labels: null } }),
  ).toMatchObject({
    status: "fail",
    reason: "Bootstrap's record has no `.bootstrap/github/`",
  });
});

test("the ruleset passes with extra live fields and rules, and fails a missing rule or a changed parameter", async () => {
  stubGithub(rulesetRoutes(liveRuleset()));
  expect(await run("ruleset-matches-record")).toMatchObject({ status: "pass" });

  stubGithub(rulesetRoutes(liveRuleset({ rules: liveRuleset().rules.filter(r => r.type !== "deletion") })));
  expect(await run("ruleset-matches-record")).toMatchObject({
    status: "fail",
    reason: "The default branch ruleset has no `deletion` rule",
    link: `https://github.com/${REPO}/settings/rules`,
  });

  const changed = liveRuleset();
  changed.rules[2] = {
    type: "pull_request",
    parameters: { allowed_merge_methods: ["merge", "squash"], required_approving_review_count: 0 },
  };
  stubGithub(rulesetRoutes(changed));
  expect(await run("ruleset-matches-record")).toMatchObject({
    status: "fail",
    reason: "The `pull_request` rule differs from bootstrap's record",
  });
});

test("a ruleset in evaluate mode, or one for another branch, doesn't protect the default branch", async () => {
  stubGithub(rulesetRoutes(liveRuleset({ enforcement: "evaluate" })));
  expect(await run("ruleset-matches-record")).toMatchObject({
    status: "fail",
    reason: "The default branch ruleset is in `evaluate` mode, not active",
  });
  stubGithub(rulesetRoutes(liveRuleset({ conditions: { ref_name: { include: ["refs/heads/dev"] } } })));
  expect(await run("ruleset-matches-record")).toMatchObject({
    status: "fail",
    reason: "No active ruleset protects the default branch",
  });
});

test("required checks are the record's plus each module's, with conditions read against the answers", async () => {
  stubGithub(rulesetRoutes(liveRuleset()));
  expect(await run("required-checks")).toMatchObject({ status: "pass" });

  const without = liveRuleset();
  without.rules[3] = {
    type: "required_status_checks",
    parameters: {
      required_status_checks: [{ context: "test" }, { context: "check-label" }, { context: "e2e-safari" }],
    },
  };
  stubGithub(rulesetRoutes(without));
  expect(await run("required-checks")).toMatchObject({
    status: "fail",
    reason: "`e2e` isn't a required check",
    link: `https://github.com/${REPO}/settings/rules`,
  });

  const privateRecord = { ...RECORD, answers: { private: true } };
  const noSafari = liveRuleset();
  noSafari.rules[3] = {
    type: "required_status_checks",
    parameters: { required_status_checks: [{ context: "test" }, { context: "check-label" }, { context: "e2e" }] },
  };
  stubGithub(rulesetRoutes(noSafari));
  expect(await run("required-checks", {}, { record: privateRecord })).toMatchObject({ status: "pass" });
});

test("a check required by classic branch protection counts", async () => {
  const none = liveRuleset();
  none.rules = none.rules.filter(r => r.type !== "required_status_checks");
  stubGithub({
    ...rulesetRoutes(none),
    [`${R}/branches/main/protection/required_status_checks`]: {
      contexts: ["test", "check-label"],
      checks: [{ context: "e2e" }, { context: "e2e-safari" }],
    },
  });
  expect(await run("required-checks")).toMatchObject({ status: "pass" });
});

test("rulesets Engage can't read are unknown, naming the permission", async () => {
  stubGithub({ [`${R}/rulesets?includes_parents=true&per_page=100`]: { status: 403 } });
  expect(await run("required-checks")).toEqual({
    status: "unknown",
    reason: "Engage can't read rulesets: grant Administration read",
    link: null,
  });
});

test("settings compare only the record's keys, nested ones too", async () => {
  stubGithub({
    [R]: {
      allow_merge_commit: false,
      allow_rebase_merge: true,
      security_and_analysis: { secret_scanning: { status: "enabled" }, other: {} },
    },
  });
  expect(await run("settings-match-record")).toMatchObject({ status: "pass" });
  stubGithub({ [R]: { allow_merge_commit: true, security_and_analysis: { secret_scanning: { status: "disabled" } } } });
  expect(await run("settings-match-record")).toMatchObject({
    status: "fail",
    reason: "`allow_merge_commit` and `security_and_analysis` differ from bootstrap's record",
  });
  stubGithub({ [R]: { allow_merge_commit: false } });
  expect(await run("settings-match-record")).toMatchObject({ status: "unknown" });
});

test("labels must all exist, ignoring case", async () => {
  stubGithub({ [`${R}/labels?per_page=100&page=1`]: [{ name: "Release: None" }, { name: "release: minor" }] });
  expect(await run("labels-match-record")).toMatchObject({ status: "pass" });
  stubGithub({ [`${R}/labels?per_page=100&page=1`]: [{ name: "release: none" }] });
  expect(await run("labels-match-record")).toMatchObject({
    status: "fail",
    reason: "The `release: minor` label is missing",
  });
});

test("files-present names a missing file, and is unknown when a read fails", async () => {
  stubGithub({ [`${R}/contents/CLAUDE.md?ref=main`]: {} });
  expect(await run("files-present", { paths: ["SECURITY.md"] })).toMatchObject({
    status: "fail",
    reason: "`SECURITY.md` is missing",
  });
  expect(await run("files-present", { paths: ["CLAUDE.md"] })).toMatchObject({ status: "pass" });
  stubGithub({ [`${R}/contents/CLAUDE.md?ref=main`]: { status: 500 } });
  expect(await run("files-present", { paths: ["CLAUDE.md"] })).toMatchObject({
    status: "unknown",
    reason: "Couldn't read `CLAUDE.md` from GitHub",
  });
});

test("dependabot needs its config and security updates on", async () => {
  const config = { [`${R}/contents/.github/dependabot.yml?ref=main`]: {} };
  stubGithub({ ...config, [R]: { security_and_analysis: { dependabot_security_updates: { status: "enabled" } } } });
  expect(await run("dependabot", { paths: [".github/dependabot.yml"] })).toMatchObject({ status: "pass" });
  stubGithub({ ...config, [R]: { security_and_analysis: { dependabot_security_updates: { status: "disabled" } } } });
  expect(await run("dependabot", { paths: [".github/dependabot.yml"] })).toMatchObject({
    status: "fail",
    reason: "Dependabot security updates are off",
  });
  stubGithub({ [R]: {} });
  expect(await run("dependabot", { paths: [".github/dependabot.yml"] })).toMatchObject({
    status: "fail",
    reason: "`.github/dependabot.yml` is missing",
  });
});

test("a workflow passes when its last real run didn't fail, or it has never run", async () => {
  const file = { [`${R}/contents/.github/workflows/project-status-sync.yml?ref=main`]: {} };
  const runs = `${R}/actions/workflows/project-status-sync.yml/runs?status=completed&per_page=20`;
  const check = { workflow: "project-status-sync.yml" };
  stubGithub({ ...file, [runs]: { workflow_runs: [] } });
  expect(await run("workflow-healthy", check)).toMatchObject({ status: "pass", reason: "Hasn't run yet" });
  stubGithub({
    ...file,
    [runs]: {
      workflow_runs: [{ conclusion: "cancelled" }, { conclusion: "failure", html_url: "https://github.com/run/1" }],
    },
  });
  expect(await run("workflow-healthy", check)).toMatchObject({
    status: "fail",
    reason: "The last `project-status-sync.yml` run failed",
    link: "https://github.com/run/1",
  });
  stubGithub({
    ...file,
    [runs]: { workflow_runs: [{ conclusion: "skipped" }, { conclusion: "success" }, { conclusion: "failure" }] },
  });
  expect(await run("workflow-healthy", check)).toMatchObject({ status: "pass" });
});

test("the release gate needs each gated environment to exist and wait for Engage's App", async () => {
  const env = `${R}/environments/production`;
  expect(await run("engage-protection-rule")).toMatchObject({ status: "n/a" });
  stubGithub({});
  expect(await run("engage-protection-rule", {}, { gated: ["production"] })).toMatchObject({
    status: "fail",
    reason: "The `production` environment doesn't exist",
  });
  stubGithub({
    [env]: {},
    [`${env}/deployment_protection_rules`]: {
      custom_deployment_protection_rules: [{ enabled: true, app: { id: 999 } }],
    },
  });
  expect(await run("engage-protection-rule", {}, { gated: ["production"] })).toMatchObject({
    status: "fail",
    reason: "The `production` environment doesn't wait for Engage",
  });
  stubGithub({
    [env]: {},
    [`${env}/deployment_protection_rules`]: {
      custom_deployment_protection_rules: [{ enabled: true, app: { id: ENGAGE_APP } }],
    },
  });
  expect(await run("engage-protection-rule", {}, { gated: ["production"] })).toMatchObject({ status: "pass" });
});

test("a long-lived Cloudflare secret fails on the repository or an environment, and unreadable secrets are unknown", async () => {
  const check = { names: ["CLOUDFLARE_API_TOKEN"] };
  const secrets = `${R}/actions/secrets?per_page=100`;
  const envs = `${R}/environments?per_page=100`;
  stubGithub({ [secrets]: { secrets: [{ name: "CLOUDFLARE_API_TOKEN" }] } });
  expect(await run("secrets-absent", check)).toMatchObject({
    status: "fail",
    reason: "`CLOUDFLARE_API_TOKEN` is a long-lived secret on this repository",
  });
  stubGithub({
    [secrets]: { secrets: [{ name: "OTHER" }] },
    [envs]: { environments: [{ name: "infra" }] },
    [`${R}/environments/infra/secrets?per_page=100`]: { secrets: [{ name: "CLOUDFLARE_API_TOKEN" }] },
  });
  expect(await run("secrets-absent", check)).toMatchObject({
    status: "fail",
    reason: "`CLOUDFLARE_API_TOKEN` is a long-lived secret in the `infra` environment",
  });
  stubGithub({ [secrets]: { status: 403 } });
  expect(await run("secrets-absent", check)).toEqual({
    status: "unknown",
    reason: "Engage can't read secrets: grant Secrets read",
    link: null,
  });
});
