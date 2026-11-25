# Engage: conformance (Module 4)

Status: approved by the maintainer on 25 November 2026 (#110), who asked for it to be built once written. Expands design §9 for the product hubs layout.

## Why

Bootstrap sets every oneloneraven repository up the same way: a ruleset on the default branch, required checks, labels, the security policy and core docs, Dependabot, the board sync, Engage's release gate, and short-lived Cloudflare deploy tokens. Settings drift quietly: a check gets dropped from a ruleset, a secret gets added by hand, a doc gets deleted. Today you find out in an incident or not at all. Engage should check each day and put drift under Needs you.

## Goals

- A daily, read-only check of every repository against what bootstrap set up for it.
- One grid of repositories against checks, each cell pass or fail with the reason and a link to fix it.
- Drift shows under Needs you, on the card of the product that owns the repository.
- Bootstrap stays the one place that says what "set up properly" means.

## Non-goals

- Fixing drift. Bootstrap and Claude fix; Engage only reports.
- Checking code quality, dependencies or CI results beyond what bootstrap configures.
- Repositories outside the `oneloneraven` organisation.

## Anti-goals: it fails if…

- A check passes because Engage couldn't read something. Unreadable is Unknown, never a pass.
- Bootstrap and Engage disagree about a rule and nothing says so.
- Engage gains any permission that can change a repository.
- A repository that bootstrap never set up looks fine.

## Decided by the maintainer

- **D9, the hybrid.** A rules file in project-bootstrap says which checks exist, which modules each applies to, and its fixed parameters. Each repository's own `.bootstrap/` record supplies its expected values: its ruleset, settings and labels.
- **D10, one central page.**
  - The grid is at `/repositories`, linked from the top bar.
  - A failing repository shows under Needs you on its product's card.
  - Repositories that belong to no product get one Repositories card on Home, after the product cards.

## Approaches (D9)

1. **Each repository's `.bootstrap/` record only.** It catches drift from exactly what was applied, but enforces nothing organisation-wide, and the design's single source in bootstrap is lost.
2. **A rules file in bootstrap only.** It's simple, but it can't know each repository's own required checks, and it repeats what the templates already say.
3. **Hybrid (chosen).** Bootstrap owns what is checked, and each repository's record owns its values. It uses records that already exist, and a missing record is itself a failure.

## The design

### Which repositories

Every repository in the organisation that the Engage App can see, that isn't archived and isn't a fork. Engage lists them through its installation (`GET /installation/repositories`, every page); the App is installed on all repositories. A repository the registry names but the installation doesn't list still gets a row, with every cell Unknown: "Engage's App can't see this repository". Rows for repositories that no longer exist are removed.

A repository belongs to a product when the registry names it as that product's `issue_repo`, `site_repo` or one of its `release_repos`. Any other repository belongs to no product.

### The rules file (project-bootstrap)

Bootstrap gains `conformance/rules.json`, published from its default branch. Engage reads it with its App token through the contents API, at the start of each run.

```json
{
  "version": 1,
  "checks": [
    { "id": "bootstrap-record", "title": "Bootstrap record", "kind": "record-present", "modules": [] },
    { "id": "ruleset", "title": "Default branch ruleset", "kind": "ruleset-matches-record", "modules": ["core"] },
    { "id": "required-checks", "title": "Required checks", "kind": "required-checks", "modules": ["core"] },
    { "id": "settings", "title": "Repository settings", "kind": "settings-match-record", "modules": ["core"] },
    { "id": "labels", "title": "Labels", "kind": "labels-match-record", "modules": ["core"] },
    { "id": "core-docs", "title": "Security policy and core docs", "kind": "files-present", "modules": ["core"],
      "paths": ["SECURITY.md", "CLAUDE.md", "docs/privacy.md", "docs/threat-model.md", "docs/workflow.md", "docs/definition-of-done.md"] },
    { "id": "dependabot", "title": "Dependabot", "kind": "dependabot", "modules": ["core"], "paths": [".github/dependabot.yml"] },
    { "id": "board-sync", "title": "Board sync", "kind": "workflow-healthy", "modules": ["core"], "workflow": "project-status-sync.yml", "step": "github:core:5" },
    { "id": "release-gate", "title": "Engage release gate", "kind": "engage-protection-rule", "modules": ["core"] },
    { "id": "no-cloudflare-secret", "title": "No long-lived Cloudflare secret", "kind": "secrets-absent",
      "modules": ["cloudflare-opentofu", "cloudflare-identity", "cloudflare-tofu-base"], "names": ["CLOUDFLARE_API_TOKEN"] }
  ],
  "requiredChecks": { "core": ["check-label", "check-public-pages"], "js-toolchain": ["lint", "typecheck", "test"] }
}
```

The paths and names above are illustrative. Slice 1 settles them against the real templates.

- **`kind` is the contract.** Engage implements each kind in code. The file chooses which checks run, for which modules, and with which parameters (`paths`, `names`, `workflow`). Engage reads those parameters from the file and hard-codes none of them.
- **`modules: []`** means the check runs on every repository.
- **`requiredChecks`** is each module's manifest `requiredChecks`, generated into the file by a bootstrap script. Bootstrap's test fails if the file and the manifests disagree. So Engage reads one file from bootstrap, never the manifests themselves.
- **`step`** (optional) names the bootstrap step that sets the check up, such as `github:core:5` for the board. If a repository's record marks that step, or one of its sub-steps (`github:core:5-link`), as skipped, the cell is Skipped, shows the recorded reason, and doesn't count as needing you.
- **An unknown kind shows Unknown** with the reason "Engage doesn't know this check yet", never a pass. So a rule added to bootstrap before Engage supports it is visible, not silent.
- **`version` is checked.** A version Engage doesn't support makes every cell Unknown, with that reason.
- **Bootstrap tests the file.** Its schema test checks that every `modules` entry names a real module, and that every `id` is unique.

### Expected values (each repository's record)

- **Ruleset:** `.bootstrap/github/ruleset.json`. The live default-branch ruleset must have every rule in the record, with the same parameters. Extra rules are allowed.
- **Required checks:** the record's `required_status_checks` contexts, plus the rules file's `requiredChecks` for each of the repository's modules. Each must be required.
- **Settings:** `.bootstrap/github/repo-settings.json`. Each key in the record must match the live value.
- **Labels:** `.bootstrap/github/labels.json`. Each label in the record must exist. Colour and description are not compared.
- **Modules:** the `modules` array in `.bootstrap/state.json`. A check runs only if one of its `modules` is among them, or its `modules` is empty. A check that doesn't apply shows "Doesn't apply" and counts as neither pass nor fail.
- **No record at all:**
  - `bootstrap-record` fails with "Bootstrap hasn't set this repository up".
  - Every other cell for that repository shows "Not checked: no bootstrap record". The repository counts once under Needs you, not once per check.

### The checks

| Kind | Passes when | Read with |
|---|---|---|
| `record-present` | `.bootstrap/state.json` and `.bootstrap/github/` exist | Contents |
| `ruleset-matches-record` | A ruleset with `enforcement: active` targets the default branch (`~DEFAULT_BRANCH` or `refs/heads/<default>`) and has every rule type in the record. Each record parameter must equal the live one; extra live fields and extra rules are allowed. The `required_status_checks` rule's list of checks is left to `required-checks`, so one missing check fails one cell. `bypass_actors` isn't compared. | Administration |
| `required-checks` | Every expected context is required, by ruleset or branch protection | Administration |
| `settings-match-record` | Every key in the record matches | Administration (for `security_and_analysis`) |
| `labels-match-record` | Every label in the record exists | Metadata |
| `files-present` | Every path exists on the default branch | Contents |
| `dependabot` | Every path in `paths` exists and Dependabot security updates are on. One cell; the reason names which part failed. | Contents, Administration |
| `workflow-healthy` | The workflow file exists, and its latest completed run wasn't a failure, of any age. Cancelled and skipped runs are ignored. A workflow that has never run passes, with "Hasn't run yet". | Contents, Actions |
| `engage-protection-rule` | Every environment in the repository's `release_repos.environments` (a JSON array in Engage's own registry) exists and has a custom deployment protection rule whose App id is Engage's (`GITHUB_APP_ID`). A missing environment fails. A repository not in `release_repos` shows "Doesn't apply". | Administration, Actions |
| `secrets-absent` | No Actions repository or environment secret has a listed name. Dependabot and Codespaces secrets aren't checked. | Secrets (read: names only) |

- **Each failure has a reason and a link.** The reason is one sentence naming what's wrong ("`e2e` isn't a required check"). The link goes to the GitHub settings page where it's fixed.
- **Unknown** covers a call that fails, times out or is refused, and a permission Engage lacks. The reason says which ("Engage can't read secrets: grant Secrets read"). A repository whose contents Engage can't read is Unknown throughout, never "no bootstrap record".
- **Cell states:** Pass, Fail, Unknown, Skipped, Doesn't apply. Only Fail needs you.

### Permissions

The Engage App already has Administration and Contents read, and Actions read. It needs **Secrets: read** added: names only, never values. Changing an App's permissions needs the maintainer's approval in GitHub, so this is an owner step in slice 2's runbook. Until it's approved, `secrets-absent` is Unknown everywhere. Every permission stays read-only, keeping the third anti-goal.

### Running

- **A daily cron step**, in the existing `17 3 * * *` run.
  - It reads the rules file once, then each repository in turn, a few at a time, within GitHub's rate limit.
  - A repository that errors part-way is written with what was read; the rest of its cells are Unknown.
- **Storage:**
  - `conformance_results (repo, check_id, status, reason, link, checked_at)`, one row per cell. Each run replaces the rows of the repositories it reached.
  - `conformance_runs (started_at, finished_at, rules_version, error)` records when it last ran.
  - No personal data. Repository names and settings only.
- **Stale results:**
  - A run is complete when it reached every repository, even if some cells came back Unknown.
  - If the last complete run is over 36 hours old, the page says so.
  - A repository whose own rows are over 36 hours old is marked stale on its row and in its Needs you entry. Its cells keep their status and show "Last checked …".

### UI

- **`/repositories`** is linked from the top bar, between the product switcher and search.
  - The page title is Repositories.
  - Its first line says when the check last ran and with which rules version.
  - The grid has one row per repository, grouped by product in registry order, then "No product". One column per check, in the rules file's order.
  - Each cell is a pass, fail or unknown mark with a text label (never colour alone). Opening a cell shows its reason and link.
  - Below 768px the grid becomes one card per repository, listing only its failing and unknown checks.
- **Needs you on a product card:** one row per failing repository: "deaftly-website has 2 checks failing", linking to `/repositories#<repo>`. Unknown doesn't count as needing you; only fail does.
- **Home's Repositories card** comes after the product cards. It has the same Needs you rows for repositories with no product, and "Every repository matches bootstrap" when none fail.
- **The verdict** counts each failing repository once.

## Delivery

1. **project-bootstrap: the rules file.** `conformance/rules.json`, its schema test, and a line in bootstrap's docs saying Engage reads it. Paths and names are settled against the real templates. This is a PR in project-bootstrap.
2. **Engage: the checker.**
   - Reads the rules file and records, implements each kind, and writes the results.
   - Runs in the daily cron, with `GET /api/repositories`.
   - Adds the runbook's owner step for Secrets read.
3. **Engage: the UI.** `/repositories`, the Needs you rows on product cards, Home's Repositories card, and the verdict.

## Calls made here, for review

- Modules come from the record's `modules` array, not step names, because a module with no GitHub steps would otherwise be dropped silently.
- Manifests' required checks are generated into `rules.json`, so Engage makes one read from bootstrap.
- A skipped step makes its check Skipped, with bootstrap's recorded reason. Deaftly's website skipped the board link, for example.
- `workflow-healthy` passes a workflow that has never run. The board sync only runs on branch and PR events, so a quiet repository would otherwise be Unknown forever.
- Engage's protection rule is matched by its App id.

## Left to the builder

- The exact GitHub endpoints for each kind, and how a ruleset's rules are compared to the record's.
- Concurrency and pacing within the cron, within `docs/workflow.md#github-api`.
- The grid's exact markup, within `docs/ui.md`.

## Not in this design

Repositories that bootstrap never set up (on current clones: beta-interpreter and engage-design, and CL and beyond-borders lack `.bootstrap/github/`) will show as failing until bootstrap backfills them. That backfill is bootstrap's own work.
