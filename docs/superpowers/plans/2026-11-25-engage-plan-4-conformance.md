# Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily, read-only check of every oneloneraven repository against what bootstrap set up for it, shown as a grid at `/repositories`, with failures under Needs you.

**Architecture:**
- project-bootstrap publishes `conformance/rules.json`: which checks exist, per module, plus the manifests' required checks, generated and tested.
- Engage's daily cron reads that file and each repository's `.bootstrap/` record through its GitHub App, runs one function per check `kind`, and stores one row per cell in D1.
- The admin API and UI read the stored rows. Nothing calls GitHub on page load.

**Tech Stack:** Cloudflare Workers, D1, vanilla JS UI, Vitest workers pool, WebdriverIO; Node's test runner in project-bootstrap.

**Spec:** `docs/superpowers/specs/2026-11-25-engage-conformance-design.md`

## Global Constraints

- Read-only: every GitHub call is a `GET`. The only new permission is the Engage App's **Secrets: read**.
- Cell states are exactly `pass`, `fail`, `unknown`, `skipped`, `n/a`. Only `fail` needs you. Anything Engage couldn't read is `unknown`, never `pass`.
- A repository counts once under Needs you, however many cells fail.
- Stale means over 36 hours (`STALE_MS = 36 * 3_600_000`).
- The rules file's `version` must be `1`; any other value makes every cell `unknown` with "Engage doesn't support rules version <n>".
- An unknown `kind` is `unknown` with "Engage doesn't know this check yet".
- Copy is British English, sentence case, and no colour-only meaning.
- Pace GitHub calls: one repository at a time, with its calls in parallel, at most 8 at once.

## Review Focus

1. **A 403 from a permission Engage lacks** (Secrets before the owner grants it) must be `unknown` with "Engage can't read secrets: grant Secrets read", not a failed run. Task 3: `secrets-absent` 403 test.
2. **A repository whose `.bootstrap/` is unreadable (403/500)** must be `unknown` throughout, never "no bootstrap record". Task 2: `readRecord` 500 test.
3. **The rules file unreachable** must leave last results in place and record the run's error, not wipe the grid. Task 4: run-with-rules-down test.
4. **A ruleset in `evaluate` mode, or one targeting another branch**, must fail `ruleset`. Task 3: ruleset tests.
5. **A registry repository missing from the installation** gets a row with every cell `unknown`. Task 4: missing-repo test.

---

### Task 1: The rules file in project-bootstrap

Its own issue, branch and PR in `oneloneraven/project-bootstrap`, with `release: none` unless its workflow says otherwise.

**Files:**
- Create: `conformance/rules.json`
- Create: `skills/bootstrap/scripts/conformance-rules.mjs`
- Create: `tests/conformance-rules.test.mjs`
- Modify: `docs/adding-a-module.md`: one line saying `requiredChecks` changes need `node skills/bootstrap/scripts/conformance-rules.mjs --write`, and that Engage reads `conformance/rules.json`.

**Interfaces:**
- Produces: `conformance/rules.json`, shaped `{ version: 1, checks: Check[], requiredChecks: Record<module, (string | { context: string, when: string | string[] })[]> }`, where `Check = { id, title, kind, modules: string[], step?, paths?, names?, workflow? }`.

- [ ] **Step 1:** Write `tests/conformance-rules.test.mjs`:
  - `"every check has a unique id, a known kind and real modules"`. Kinds: `record-present`, `ruleset-matches-record`, `required-checks`, `settings-match-record`, `labels-match-record`, `files-present`, `dependabot`, `workflow-healthy`, `engage-protection-rule`, `secrets-absent`. Modules must be folder names under `skills/bootstrap/modules/`.
  - `"requiredChecks matches every module manifest"`, which deep-equals the generated value.
  - `"every files-present path is a file core writes"`, checking each path against the `to` values in core's `manifest.json` `files`.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL, because the file is missing.
- [ ] **Step 3:** Write `conformance-rules.mjs` with `generateRequiredChecks(modulesDir) → Record<string, …>`. `--write` updates the file in place; `--check` exits 1 on drift. Write `rules.json` with the spec's checks.
  - Core-docs paths: the core manifest's `to` values for `SECURITY.md`, `CLAUDE.md`, `docs/privacy.md`, `docs/threat-model.md`, `docs/workflow.md` and `docs/definition-of-done.md`.
  - Board sync: `step` is `"github:core:5"` (sub-steps such as `5-link` match it); ruleset and required checks `"github:core:4"`; labels `"github:core:3"`, and `workflow` is `"project-status-sync.yml"`.
  - Secrets: `names` is `["CLOUDFLARE_API_TOKEN"]`.
- [ ] **Step 4:** Run `pnpm test`, then the identifier guard. Expected: PASS.
- [ ] **Step 5:** Commit, open the draft PR with its label, then mark it ready.

### Task 2: Rules and record readers (Engage)

**Files:**
- Create: `src/conformance/github.js`, `src/conformance/rules.js`, `src/conformance/record.js`
- Test: `test/conformance-read.test.js`

**Interfaces:**
- Produces:
  - `reader(token: string) → { get(path: string): Promise<{ status: number, body: any }>, file(repo: string, path: string, ref?: string): Promise<string | null> }`. `get` never throws on 4xx/5xx; it returns the status. A network error or timeout (10 s) comes back as status `0`. `file` returns the decoded text, `null` on 404, and throws `ReadError` otherwise.
  - `parseRules(text: string) → { version: number, checks: Check[], requiredChecks: Record<string, RequiredCheck[]> }`, which throws `RulesError(message)` when malformed.
  - `readRecord(read, repo, defaultBranch) → Record | null`, where `Record = { modules: string[], skipped: Record<string,string>, answers: Record<string, unknown>, ruleset: any | null, settings: any | null, labels: { name: string }[] | null }`. It returns `null` when `.bootstrap/state.json` is 404 and throws `ReadError` on any other failure.
  - `whenHolds(when, answers) → boolean`, for a key, `!key` or an array (any element holds).

- [ ] **Step 1:** Write failing tests:
  - `parseRules` accepts the spec's example. It throws on non-JSON and on a check without `id`/`kind`. It keeps an unknown kind.
  - `readRecord` reads modules and skipped from `state.json`. It returns `null` on a 404. It throws on a 500.
  - `whenHolds("!private", { private: false })` is `true`; `whenHolds(["a","b"], { b: true })` is `true`.
- [ ] **Step 2:** Run `pnpm vitest run test/conformance-read.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement. `file` uses `GET /repos/{repo}/contents/{path}?ref=` and base64-decodes `content`.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 3: One function per kind (Engage)

**Files:**
- Create: `src/conformance/kinds.js`
- Test: `test/conformance-kinds.test.js`

**Interfaces:**
- Consumes: Task 2's `reader`, `Record` and `whenHolds`.
- Produces:
  - `KINDS: Record<string, (ctx: KindContext) => Promise<Cell>>`.
  - `KindContext = { read, repo: string, defaultBranch: string, record: Record, check: Check, rules, gated: string[] | null, engageAppId: number }`.
  - `Cell = { status: "pass" | "fail" | "unknown", reason: string, link: string | null }`.
  - `unreadable(what: string, status: number) → Cell`, which gives "Engage can't read <what>: grant <permission>" for 403 and "Couldn't read <what> from GitHub" otherwise.

- [ ] **Step 1:** Write one failing test per kind for pass and fail, with `fetch` stubbed per path.
  - Reasons and links pinned:
    - `required-checks` missing `e2e` gives `fail` with reason "`e2e` isn't a required check" and link `https://github.com/<repo>/settings/rules`.
    - `files-present` missing `SECURITY.md` gives "`SECURITY.md` is missing".
    - `secrets-absent` with `CLOUDFLARE_API_TOKEN` gives "`CLOUDFLARE_API_TOKEN` is a long-lived secret on this repository".
    - `engage-protection-rule` with a missing environment gives "The `production` environment doesn't exist".
    - `workflow-healthy` that has never run gives `pass`, "Hasn't run yet".
  - Ruleset: an `evaluate` ruleset and a ruleset targeting `refs/heads/dev` both give `fail`.
  - Required-checks conditions: `{ context: "e2e-safari", when: "!private" }` isn't required for a repository whose answers have `private: true`.
  - Secrets 403: `secrets-absent` gives `unknown`, "Engage can't read secrets: grant Secrets read".
- [ ] **Step 2:** Run `pnpm vitest run test/conformance-kinds.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement each kind per the spec's table.
  - Rulesets: `GET /repos/{r}/rulesets?includes_parents=true`, then `GET /repos/{r}/rulesets/{id}` for each.
  - Comparison: a record parameter must equal the live one by deep equality over the record's own keys only.
  - Protection rules: `GET /repos/{r}/environments/{env}/deployment_protection_rules`, matching `custom_deployment_protection_rules[].app.id`.
  - Secrets: `GET /repos/{r}/actions/secrets`, and each environment's `GET /repos/{r}/environments/{env}/secrets`.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 4: The run, storage and cron (Engage)

**Files:**
- Create: `migrations/0014_conformance.sql`, `src/conformance/run.js`
- Modify: `src/worker.js`, adding `runConformance` to `"17 3 * * *"`
- Test: `test/conformance-run.test.js`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:
  - `runConformance(env, now: Date) → Promise<void>`.
  - Tables:
    - `conformance_results (repo TEXT, check_id TEXT, status TEXT CHECK (status IN ('pass','fail','unknown','skipped','n/a')), reason TEXT, link TEXT, checked_at TEXT, PRIMARY KEY (repo, check_id))`;
    - `conformance_runs (id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, rules_version INTEGER, complete INTEGER, error TEXT)`;
    - `conformance_checks (id TEXT PRIMARY KEY, title TEXT, position INTEGER)`, the last rules' columns, for the grid header.

- [ ] **Step 1:** Write failing tests:
  - A full run writes one row per repository and check, with the right states:
    - `n/a` for a module that isn't present;
    - `skipped` with the reason, for a skipped `step`;
    - every other cell "Not checked: no bootstrap record" when there's no record.
  - Archived repositories and forks are left out.
  - A registry repository missing from the installation gets every cell `unknown`, "Engage's App can't see this repository".
  - Rules unreachable: results are unchanged, and the run has `error = "rules-unavailable"` and `complete = 0`.
  - Rows for a repository no longer listed are deleted.
  - Version 2 makes every cell `unknown`, "Engage doesn't support rules version 2".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Repositories come from `GET /installation/repositories?per_page=100`, every page, with the token from `installationToken(env, "oneloneraven")`.
  - Rules come from `oneloneraven/project-bootstrap` `conformance/rules.json` on its default branch.
  - The registry repositories are `issue_repo`, `site_repo` and `release_repos.repo`.
  - Writes are `env.DB.batch` per repository.
  - Log `conformance.checked` with counts only.
- [ ] **Step 4:** Run, then `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 5: Reading results: API and counts (Engage)

**Files:**
- Create: `src/conformance/read.js`
- Modify: `src/admin/router.js` (`GET /api/repositories`) and `src/admin/items.js` (`counts`)
- Test: `test/conformance-api.test.js`

**Interfaces:**
- Produces:
  - `readConformance(env, now) → { lastRun: { finishedAt, rulesVersion, complete, stale } | null, checks: { id, title }[], repositories: Repo[] }`, where `Repo = { repo: string, name: string, product: string | null, checkedAt: string, stale: boolean, failing: number, cells: Record<checkId, { status, reason, link }> }`. Repositories are ordered by product in registry order, then those with no product, alphabetically within each group.
  - `counts()` gains:
    - `byProduct[slug].repositoriesFailing: { repo, name, failing, stale }[]`;
    - `noProductRepositoriesFailing: { repo, name, failing, stale }[]`;
    - `repositoriesFailing: number`, the count of failing repositories.

- [ ] **Step 1:** Write failing tests:
  - The API groups and orders repositories.
  - `failing` counts only `fail`.
  - `stale` comes from `checked_at` older than 36 h.
  - `counts` puts `oneloneraven/deaftly-website` under `deaftly` and `oneloneraven/engage` under no product.
  - `repositoriesFailing` counts each repository once.
- [ ] **Step 2–4:** Run, implement, run. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 6: UI (Engage)

**Files:**
- Create: `src/ui/pages/repositories.js`
- Modify:
  - `src/ui/main.js` (route `/repositories`, ahead of the hub pattern);
  - `src/ui/shell.js` (a "Repositories" link between the switcher and search);
  - `src/ui/pages/home.js` (a repository row on product cards; the Repositories card after product cards);
  - `src/ui/format.js` (`verdict` counts `repositoriesFailing`; `hubSummary` unchanged);
  - `src/ui/api.js` (`getRepositories`);
  - `src/ui/styles.css`;
  - `docs/ui.md`.
- Test: `test/ui-format.test.js`, `e2e/admin.spec.js`, `e2e/accessibility.spec.js`, `e2e/fixtures.js`

**Interfaces:**
- Consumes: Task 5's shapes.

- [ ] **Step 1:** Write failing unit tests: `verdict({ repositoriesFailing: 2 })` is `"2 things need you."`.
- [ ] **Step 2:** Write failing e2e tests. Fixtures seed `conformance_results`, `conformance_checks` and `conformance_runs` for one failing CL repository and one passing no-product repository.
  - The grid shows a row per repository with a text label in each cell. Opening a failing cell shows its reason and link.
  - CL's card has "climbing-logbook has 1 check failing", linking to `/repositories#oneloneraven/climbing-logbook`.
  - Home's Repositories card says "Every repository matches bootstrap" when no unowned repository fails.
  - axe covers `/repositories` at both widths.
- [ ] **Step 3:** Implement.
  - **Wide screens:** a `<table>` with a `<caption>`, `<th scope="row">` for the repository and `<th scope="col">` for each check.
  - **Cells:** each is a `<button>` whose label is "Pass", "Fail", "Unknown", "Skipped" or "Doesn't apply", with a mark shape beside it. Activating it opens a `details`-style panel under the table with the reason and "Fix in GitHub".
  - **Below 768px:** one card per repository listing only its failing and unknown checks.
  - **Staleness:** "Last checked …" shows on stale rows. The page's first line says when it last ran and with which rules version, or "Engage hasn't checked repositories yet".
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`, then check it in the browser at desktop and 375px. Expected: PASS, with no horizontal scroll at 375px except inside the grid's own scroller.
- [ ] **Step 5:** Commit. The PR includes the runbook owner step: grant the Engage App **Secrets: read** (`docs/runbooks/github-app.md`), a threat-model row for Engage → GitHub conformance reads, and the record of processing (repository settings only, no personal data).
