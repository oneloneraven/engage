import { installationToken } from "../github/app.js";
import { log } from "../lib/log.js";
import { ReadError, reader } from "./github.js";
import { KINDS } from "./kinds.js";
import { readRecord, skippedReason } from "./record.js";
import { parseRules, RulesError, SUPPORTED_VERSION } from "./rules.js";

const ORG = "oneloneraven";
const RULES_REPO = `${ORG}/project-bootstrap`;
const RULES_PATH = "conformance/rules.json";
const MAX_PAGES = 20;

/**
 * @typedef {import("./kinds.js").Cell | { status: "skipped", reason: string, link: null }} StoredCell
 * @typedef {{ DB: import("../lib/db.js").Database, GITHUB_APP_ID?: string, GITHUB_APP_PRIVATE_KEY?: string, APP_ENV?: string, RELEASE_VERSION?: string }} ConformanceEnv
 */

/** @param {string} reason @returns {StoredCell} */
const unknown = reason => ({ status: "unknown", reason, link: null });

/**
 * Every repository Engage's installation can see that isn't archived or a fork, with its default branch.
 * @param {import("./github.js").Reader} read
 * @returns {Promise<{ repo: string, defaultBranch: string }[] | null>}
 */
async function installedRepositories(read) {
  const repos = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { status, body } = await read.get(`/installation/repositories?per_page=100&page=${page}`);
    if (status !== 200) return null;
    for (const r of body?.repositories ?? [])
      if (!r.archived && !r.fork && String(r.full_name).toLowerCase().startsWith(`${ORG}/`))
        repos.push({ repo: String(r.full_name), defaultBranch: String(r.default_branch ?? "main") });
    if ((body?.repositories ?? []).length < 100) return repos;
  }
  return repos;
}

/**
 * One repository's cell for every check.
 * @param {{ read: import("./github.js").Reader, repo: string, defaultBranch: string, rules: import("./rules.js").Rules, gated: string[] | null, engageAppId: number }} options
 * @returns {Promise<Map<string, StoredCell>>}
 */
async function checkRepository({ read, repo, defaultBranch, rules, gated, engageAppId }) {
  /** @type {Map<string, StoredCell>} */
  const cells = new Map();
  /** @type {import("./record.js").BootstrapRecord | null} */
  let record = null;
  try {
    record = await readRecord(read, repo, defaultBranch);
  } catch (error) {
    const status = error instanceof ReadError ? error.status : 0;
    const reason =
      status === 403
        ? "Engage can't read the bootstrap record: grant Contents read"
        : "Couldn't read the bootstrap record from GitHub";
    for (const check of rules.checks) cells.set(check.id, unknown(reason));
    return cells;
  }
  await Promise.all(
    rules.checks.map(async check => {
      const run = Object.hasOwn(KINDS, check.kind) ? KINDS[check.kind] : null;
      /** @type {StoredCell} */
      let cell;
      if (!run) cell = unknown("Engage doesn't know this check yet");
      else if (!record && check.kind !== "record-present")
        cell = { status: "n/a", reason: "Not checked: no bootstrap record", link: null };
      else if (record && check.modules.length && !check.modules.some(module => record?.modules.includes(module)))
        cell = { status: "n/a", reason: "Doesn't apply", link: null };
      else {
        const skipped = record && skippedReason(record, check.step);
        if (skipped) cell = { status: "skipped", reason: `Skipped at bootstrap: ${skipped}`, link: null };
        else
          try {
            cell = await run({ read, repo, defaultBranch, record, check, rules, gated, engageAppId });
          } catch {
            cell = unknown("Couldn't read this from GitHub");
          }
      }
      cells.set(check.id, cell);
    }),
  );
  return cells;
}

/**
 * Checks every repository against bootstrap's rules and stores one row per repository and check. Read-only towards
 * GitHub. When the rules or the repository list can't be read, the last results stay and the run records why.
 * @param {ConformanceEnv} env
 * @param {Date} now
 */
export async function runConformance(env, now) {
  const startedAt = now.toISOString();
  const runId = Number(
    (await env.DB.prepare("INSERT INTO conformance_runs (started_at) VALUES (?) RETURNING id").bind(startedAt).first())
      ?.id,
  );
  /** @param {string | null} error @param {{ version?: number, complete?: boolean }} [rest] */
  const finish = (error, { version, complete = false } = {}) =>
    env.DB.prepare(
      "UPDATE conformance_runs SET finished_at = ?, rules_version = ?, complete = ?, error = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), version ?? null, complete ? 1 : 0, error, runId)
      .run();

  let read;
  try {
    read = reader(await installationToken(env, ORG));
  } catch {
    log(env, "warn", "conformance.no-token");
    await finish("github-app-unavailable");
    return;
  }

  let rules;
  try {
    const text = await read.file(RULES_REPO, RULES_PATH);
    if (text === null) throw new ReadError(RULES_PATH, 404);
    rules = parseRules(text);
  } catch (error) {
    const code = error instanceof RulesError ? "rules-malformed" : "rules-unavailable";
    log(env, "warn", `conformance.${code}`);
    await finish(code);
    return;
  }

  const installed = await installedRepositories(read);
  if (!installed) {
    log(env, "warn", "conformance.repositories-unavailable");
    await finish("repositories-unavailable", { version: rules.version });
    return;
  }

  const [products, gatedRows] = await Promise.all([
    env.DB.prepare("SELECT issue_repo, site_repo FROM products").all(),
    env.DB.prepare("SELECT repo, environments FROM release_repos").all(),
  ]);
  /** @type {Map<string, string[]>} */
  const gated = new Map();
  for (const row of gatedRows.results) {
    let environments = [];
    try {
      const parsed = JSON.parse(String(row.environments));
      if (Array.isArray(parsed)) environments = parsed.map(String);
    } catch {
      environments = [];
    }
    gated.set(String(row.repo).toLowerCase(), environments);
  }
  const registry = new Set(
    [...products.results.flatMap(row => [row.issue_repo, row.site_repo]), ...gatedRows.results.map(row => row.repo)]
      .filter(Boolean)
      .map(repo => String(repo)),
  );
  const seen = new Set(installed.map(({ repo }) => repo.toLowerCase()));
  const invisible = [...registry].filter(repo => !seen.has(repo.toLowerCase()));

  await env.DB.batch([
    env.DB.prepare("DELETE FROM conformance_checks"),
    ...rules.checks.map((check, position) =>
      env.DB.prepare("INSERT INTO conformance_checks (id, title, position) VALUES (?, ?, ?)").bind(
        check.id,
        check.title,
        position,
      ),
    ),
  ]);

  const engageAppId = Number(env.GITHUB_APP_ID);
  let failing = 0;
  /** @param {string} repo @param {Map<string, StoredCell>} cells */
  const store = async (repo, cells) => {
    const checkedAt = new Date().toISOString();
    failing += [...cells.values()].some(cell => cell.status === "fail") ? 1 : 0;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM conformance_results WHERE repo = ?").bind(repo),
      ...[...cells].map(([checkId, cell]) =>
        env.DB.prepare(
          "INSERT INTO conformance_results (repo, check_id, status, reason, link, checked_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(repo, checkId, cell.status, cell.reason, cell.link, checkedAt),
      ),
    ]);
  };

  for (const { repo, defaultBranch } of installed) {
    /** @type {Map<string, StoredCell>} */
    let cells;
    if (rules.version !== SUPPORTED_VERSION)
      cells = new Map(
        rules.checks.map(check => [check.id, unknown(`Engage doesn't support rules version ${rules.version}`)]),
      );
    else
      cells = await checkRepository({
        read,
        repo,
        defaultBranch,
        rules,
        gated: gated.get(repo.toLowerCase()) ?? null,
        engageAppId,
      });
    await store(repo, cells);
  }
  for (const repo of invisible)
    await store(
      repo,
      new Map(rules.checks.map(check => [check.id, unknown("Engage's App can't see this repository")])),
    );

  const kept = [...installed.map(({ repo }) => repo), ...invisible];
  await env.DB.prepare("DELETE FROM conformance_results WHERE repo NOT IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(kept))
    .run();
  await finish(null, { version: rules.version, complete: true });
  log(env, "info", "conformance.checked", { repositories: kept.length, failing });
}
