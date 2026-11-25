import { whenHolds } from "./rules.js";

/**
 * @typedef {"pass" | "fail" | "unknown" | "n/a"} CellStatus
 * @typedef {{ status: CellStatus, reason: string, link: string | null }} Cell
 * @typedef {{
 *   read: import("./github.js").Reader,
 *   repo: string,
 *   defaultBranch: string,
 *   record: import("./record.js").BootstrapRecord | null,
 *   check: import("./rules.js").Check,
 *   rules: import("./rules.js").Rules,
 *   gated: string[] | null,
 *   engageAppId: number,
 * }} KindContext
 */

const FAILED_RUN = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
const IGNORED_RUN = new Set(["cancelled", "skipped", "stale"]);

/** @param {string} repo @param {string} [page] */
const github = (repo, page = "") => `https://github.com/${repo}${page}`;

/** @param {string} reason @param {string | null} [link] @returns {Cell} */
const pass = (reason = "", link = null) => ({ status: "pass", reason, link });
/** @param {string} reason @param {string | null} link @returns {Cell} */
const fail = (reason, link) => ({ status: "fail", reason, link });

/**
 * What a refused or failed read means, naming the permission when GitHub refused it.
 * @param {string} what
 * @param {number} status
 * @param {string} permission
 * @returns {Cell}
 */
export const unreadable = (what, status, permission) => ({
  status: "unknown",
  reason: status === 403 ? `Engage can't read ${what}: grant ${permission}` : `Couldn't read ${what} from GitHub`,
  link: null,
});

/** @param {string[]} names @param {string} one @param {string} many */
const listed = (names, one, many) => {
  const quoted = names.map(name => `\`${name}\``);
  return names.length === 1 ? `${quoted[0]} ${one}` : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)} ${many}`;
};

/**
 * True when every key in `expected` has the same value in `actual`, recursively; keys only `actual` has don't matter.
 * @param {unknown} expected
 * @param {unknown} actual
 * @returns {boolean}
 */
function covers(expected, actual) {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) && expected.length === actual.length && expected.every((item, n) => covers(item, actual[n]))
    );
  if (expected && typeof expected === "object")
    return (
      Boolean(actual) &&
      typeof actual === "object" &&
      Object.entries(expected).every(([key, value]) =>
        covers(value, /** @type {Record<string, unknown>} */ (actual)[key]),
      )
    );
  return expected === actual;
}

/**
 * The repository's rulesets that target its default branch, each with its rules.
 * @param {KindContext} ctx
 * @returns {Promise<{ status: number, rulesets: any[] }>}
 */
async function branchRulesets(ctx) {
  const list = await ctx.read.get(`/repos/${ctx.repo}/rulesets?includes_parents=true&per_page=100`);
  if (list.status !== 200) return { status: list.status, rulesets: [] };
  const targets = new Set(["~DEFAULT_BRANCH", "~ALL", `refs/heads/${ctx.defaultBranch}`]);
  const details = await Promise.all(
    list.body
      .filter((/** @type {any} */ r) => r.target === "branch")
      .map((/** @type {any} */ r) => ctx.read.get(`/repos/${ctx.repo}/rulesets/${r.id}`)),
  );
  if (details.some(d => d.status !== 200))
    return { status: details.find(d => d.status !== 200)?.status ?? 0, rulesets: [] };
  return {
    status: 200,
    rulesets: details
      .map(d => d.body)
      .filter(r => (r.conditions?.ref_name?.include ?? []).some((/** @type {string} */ ref) => targets.has(ref))),
  };
}

/** @param {any} ruleset */
const requiredContexts = ruleset =>
  (ruleset?.rules ?? [])
    .filter((/** @type {any} */ rule) => rule.type === "required_status_checks")
    .flatMap((/** @type {any} */ rule) => rule.parameters?.required_status_checks ?? [])
    .map((/** @type {any} */ check) => String(check.context));

/** @param {KindContext} ctx @param {string} name */
const recordMissing = (ctx, name) =>
  fail(`Bootstrap's record has no \`.bootstrap/github/${name}\``, github(ctx.repo, "/tree/HEAD/.bootstrap"));

/** @type {Record<string, (ctx: KindContext) => Promise<Cell>>} */
export const KINDS = {
  async "record-present"(ctx) {
    if (!ctx.record) return fail("Bootstrap hasn't set this repository up", github(ctx.repo));
    if (!ctx.record.ruleset && !ctx.record.settings && !ctx.record.labels)
      return fail("Bootstrap's record has no `.bootstrap/github/`", github(ctx.repo, "/tree/HEAD/.bootstrap"));
    return pass();
  },

  async "ruleset-matches-record"(ctx) {
    if (!ctx.record?.ruleset) return recordMissing(ctx, "ruleset.json");
    const link = github(ctx.repo, "/settings/rules");
    const { status, rulesets } = await branchRulesets(ctx);
    if (status !== 200) return unreadable("rulesets", status, "Administration read");
    const active = rulesets.filter(r => r.enforcement === "active");
    if (!active.length) {
      const other = rulesets[0];
      return fail(
        other
          ? `The default branch ruleset is in \`${other.enforcement}\` mode, not active`
          : "No active ruleset protects the default branch",
        link,
      );
    }
    const live = active.flatMap(r => r.rules ?? []);
    for (const rule of ctx.record.ruleset.rules ?? []) {
      const same = live.filter((/** @type {any} */ r) => r.type === rule.type);
      if (!same.length) return fail(`The default branch ruleset has no \`${rule.type}\` rule`, link);
      if (rule.type === "required_status_checks") continue;
      if (!same.some((/** @type {any} */ r) => covers(rule.parameters ?? {}, r.parameters ?? {})))
        return fail(`The \`${rule.type}\` rule differs from bootstrap's record`, link);
    }
    return pass();
  },

  async "required-checks"(ctx) {
    if (!ctx.record?.ruleset) return recordMissing(ctx, "ruleset.json");
    const { answers, modules } = ctx.record;
    const expected = new Set(requiredContexts(ctx.record.ruleset));
    for (const module of modules)
      for (const check of ctx.rules.requiredChecks[module] ?? [])
        if (typeof check === "string") expected.add(check);
        else if (whenHolds(check.when, answers)) expected.add(check.context);
    const { status, rulesets } = await branchRulesets(ctx);
    if (status !== 200) return unreadable("rulesets", status, "Administration read");
    const required = new Set(rulesets.filter(r => r.enforcement === "active").flatMap(requiredContexts));
    const protection = await ctx.read.get(
      `/repos/${ctx.repo}/branches/${encodeURIComponent(ctx.defaultBranch)}/protection/required_status_checks`,
    );
    if (protection.status === 200) {
      for (const context of protection.body?.contexts ?? []) required.add(String(context));
      for (const check of protection.body?.checks ?? []) required.add(String(check.context));
    } else if (protection.status !== 404)
      return unreadable("branch protection", protection.status, "Administration read");
    const missing = [...expected].filter(context => !required.has(context));
    return missing.length
      ? fail(listed(missing, "isn't a required check", "aren't required checks"), github(ctx.repo, "/settings/rules"))
      : pass();
  },

  async "settings-match-record"(ctx) {
    if (!ctx.record?.settings) return recordMissing(ctx, "repo-settings.json");
    const { status, body } = await ctx.read.get(`/repos/${ctx.repo}`);
    if (status !== 200) return unreadable("the repository's settings", status, "Administration read");
    const keys = Object.keys(ctx.record.settings);
    const hidden = keys.filter(key => !Object.hasOwn(body, key));
    if (hidden.length) return unreadable(`\`${hidden[0]}\``, 403, "Administration read");
    const differ = keys.filter(key => !covers(ctx.record?.settings[key], body[key]));
    return differ.length
      ? fail(
          listed(differ, "differs from bootstrap's record", "differ from bootstrap's record"),
          github(ctx.repo, "/settings"),
        )
      : pass();
  },

  async "labels-match-record"(ctx) {
    if (!ctx.record?.labels) return recordMissing(ctx, "labels.json");
    /** @type {Set<string>} */
    const live = new Set();
    for (let page = 1; page <= 10; page++) {
      const { status, body } = await ctx.read.get(`/repos/${ctx.repo}/labels?per_page=100&page=${page}`);
      if (status !== 200) return unreadable("labels", status, "Metadata read");
      for (const label of body) live.add(String(label.name).toLowerCase());
      if (body.length < 100) break;
    }
    const missing = ctx.record.labels.map(label => String(label.name)).filter(name => !live.has(name.toLowerCase()));
    return missing.length
      ? fail(
          missing.length === 1 ? `The \`${missing[0]}\` label is missing` : listed(missing, "", "labels are missing"),
          github(ctx.repo, "/labels"),
        )
      : pass();
  },

  async "files-present"(ctx) {
    return filesPresent(ctx, ctx.check.paths ?? []);
  },

  async dependabot(ctx) {
    const files = await filesPresent(ctx, ctx.check.paths ?? []);
    if (files.status !== "pass") return files;
    const { status, body } = await ctx.read.get(`/repos/${ctx.repo}`);
    if (status !== 200) return unreadable("the repository's settings", status, "Administration read");
    const updates = body?.security_and_analysis?.dependabot_security_updates?.status;
    if (updates === undefined) return unreadable("Dependabot security updates", 403, "Administration read");
    return updates === "enabled"
      ? pass()
      : fail("Dependabot security updates are off", github(ctx.repo, "/settings/security_analysis"));
  },

  async "workflow-healthy"(ctx) {
    const workflow = ctx.check.workflow ?? "";
    const present = await filesPresent(ctx, [`.github/workflows/${workflow}`]);
    if (present.status !== "pass") return present;
    const { status, body } = await ctx.read.get(
      `/repos/${ctx.repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?status=completed&per_page=20`,
    );
    if (status !== 200) return unreadable("workflow runs", status, "Actions read");
    const last = (body?.workflow_runs ?? []).find((/** @type {any} */ run) => !IGNORED_RUN.has(run.conclusion));
    if (!last) return pass("Hasn't run yet");
    return FAILED_RUN.has(last.conclusion)
      ? fail(`The last \`${workflow}\` run failed`, String(last.html_url ?? github(ctx.repo, "/actions")))
      : pass();
  },

  async "engage-protection-rule"(ctx) {
    if (!ctx.gated) return { status: "n/a", reason: "Engage doesn't gate this repository's releases", link: null };
    const link = github(ctx.repo, "/settings/environments");
    for (const environment of ctx.gated) {
      const path = `/repos/${ctx.repo}/environments/${encodeURIComponent(environment)}`;
      const exists = await ctx.read.get(path);
      if (exists.status === 404) return fail(`The \`${environment}\` environment doesn't exist`, link);
      if (exists.status !== 200) return unreadable("environments", exists.status, "Administration read");
      const rules = await ctx.read.get(`${path}/deployment_protection_rules`);
      if (rules.status !== 200) return unreadable("deployment protection rules", rules.status, "Actions read");
      const waits = (rules.body?.custom_deployment_protection_rules ?? []).some(
        (/** @type {any} */ rule) => rule.enabled !== false && Number(rule.app?.id) === ctx.engageAppId,
      );
      if (!waits) return fail(`The \`${environment}\` environment doesn't wait for Engage`, link);
    }
    return pass();
  },

  async "secrets-absent"(ctx) {
    const names = new Set(ctx.check.names ?? []);
    const repoSecrets = await ctx.read.get(`/repos/${ctx.repo}/actions/secrets?per_page=100`);
    if (repoSecrets.status !== 200) return unreadable("secrets", repoSecrets.status, "Secrets read");
    const onRepo = (repoSecrets.body?.secrets ?? []).find((/** @type {any} */ s) => names.has(s.name));
    if (onRepo)
      return fail(
        `\`${onRepo.name}\` is a long-lived secret on this repository`,
        github(ctx.repo, "/settings/secrets/actions"),
      );
    const environments = await ctx.read.get(`/repos/${ctx.repo}/environments?per_page=100`);
    if (environments.status !== 200) return unreadable("environments", environments.status, "Administration read");
    for (const { name: environment } of environments.body?.environments ?? []) {
      const secrets = await ctx.read.get(
        `/repos/${ctx.repo}/environments/${encodeURIComponent(environment)}/secrets?per_page=100`,
      );
      if (secrets.status !== 200) return unreadable("secrets", secrets.status, "Secrets read");
      const found = (secrets.body?.secrets ?? []).find((/** @type {any} */ s) => names.has(s.name));
      if (found)
        return fail(
          `\`${found.name}\` is a long-lived secret in the \`${environment}\` environment`,
          github(ctx.repo, "/settings/environments"),
        );
    }
    return pass();
  },
};

/**
 * @param {KindContext} ctx
 * @param {string[]} paths
 * @returns {Promise<Cell>}
 */
async function filesPresent(ctx, paths) {
  const found = await Promise.all(
    paths.map(async path => {
      const { status } = await ctx.read.get(
        `/repos/${ctx.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ctx.defaultBranch)}`,
      );
      return { path, status };
    }),
  );
  const failed = found.find(f => f.status !== 200 && f.status !== 404);
  if (failed) return unreadable(`\`${failed.path}\``, failed.status, "Contents read");
  const missing = found.filter(f => f.status === 404).map(f => f.path);
  return missing.length ? fail(listed(missing, "is missing", "are missing"), github(ctx.repo)) : pass();
}
