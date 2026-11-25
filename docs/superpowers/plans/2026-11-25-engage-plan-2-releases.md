# Engage Plan 2: Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every product deploy to `production`, `beta` and `infra`, and every Android `release`, waits for the owner's approval in Engage. Cloudflare deploy credentials come only from Engage, for an approved run, so someone with the GitHub account alone can't deploy.

**Architecture:** Engage's GitHub App becomes a custom deployment protection rule. A `deployment_protection_rule` webhook stores a pending release and pings Discord. The admin UI shows it under Needs you and Releases, and approving it calls GitHub's review endpoint. Deploy jobs then exchange a GitHub OIDC token at `POST /v1/deploy-credentials` for a short-lived Cloudflare token, which is minted only when an approved, unused release matches the token's claims exactly.

**Tech Stack:** Cloudflare Workers, D1, the existing GitHub App (`src/github/app.js`), Web Crypto for RS256 verification, the Cloudflare API for token minting, and vanilla JS UI on the Ember direction (`docs/ui.md`).

**Spec:** `docs/superpowers/specs/2026-11-12-engage-design.md` §6 (Releases), §7 (Home), §10 (Security summary). UI: `docs/ui.md` (Releases section).

## Global Constraints

- Gated environments: `production`, `beta` and `infra` on Workers repositories, and `release` on Android repositories. PR previews aren't gated (§6).
- `production` and `beta` are approved separately: each deploy is its own release.
- Engage doesn't gate itself. Its own `production` uses GitHub's required reviewer, and a break-glass runbook covers deploying it by hand (§6).
- Discord pings are content-free: the kind, the product and a link behind Access (§10, `src/discord.js`).
- Everything state-changing goes into the audit log through `recordAudit` (§10).
- Credentials minted by the broker expire in under an hour, are scoped to that product's resources, and every mint is logged (§6).
- An approved release is spent by the first credential it yields. A second exchange for the same run fails.
- The parent Cloudflare credential is a Worker secret, `CLOUDFLARE_BROKER_TOKEN`, used only by the broker module.
- The OIDC audience is `engage`.
- UI copy follows `docs/ui.md`: "Approve release", "Reject", sentence case, and no blue.

## Review Focus

1. **A webhook for a repository no product registers.** Expect 204 and nothing stored. Without this, any repository that installs the App could fill the Releases list. *(Task 2 test.)*
2. **The same `deployment_protection_rule` delivered twice** (GitHub retries). Expect one release, not two. *(Task 2 test: unique key on `run_id` + `environment`.)*
3. **An OIDC token that's valid but for a different SHA, environment or run than the approved release.** Expect 403 and no mint. *(Task 6 test.)*
4. **Approving a release whose run GitHub has already cancelled or timed out.** Expect GitHub's 4xx to come back as a plain error ("GitHub no longer waits on this run: start it again."), with the release marked `expired` rather than left pending. *(Task 3 test.)*
5. **The broker called twice for one approved run** (a retried job). Expect the second call to be refused with 409, so a credential is never minted twice. *(Task 6 test.)*

---

## File structure

| File | Responsibility |
|---|---|
| `migrations/0006_releases.sql` | `release_repos` registry and the `releases` table |
| `src/releases/registry.js` | Which repositories and environments are gated, and for which product |
| `src/releases/store.js` | Create, list, get, decide and spend releases |
| `src/releases/gate.js` | The `deployment_protection_rule` webhook handler |
| `src/releases/review.js` | Calls GitHub to approve or reject, and fetches the PRs and checks for a release |
| `src/releases/oidc.js` | Verifies a GitHub Actions OIDC token |
| `src/releases/broker.js` | `POST /v1/deploy-credentials`: matches and spends a release, then mints a Cloudflare token |
| `src/admin/router.js` | Adds `/api/releases` routes |
| `src/ui/pages/releases.js` | The Releases page |
| `src/ui/shell.js`, `src/ui/pages/home.js` | The rail entry and badge, and Home's release rows |
| `docs/runbooks/release-gate.md` | Enabling the gate on a repository, and Engage's break-glass deploy |

### Task 1: Release registry and store

**Files:**
- Create: `migrations/0006_releases.sql`, `src/releases/registry.js`, `src/releases/store.js`
- Test: `test/releases-store.test.js`

**Interfaces:**
- Produces:
  - `gatedRepo(env, repo: string) => Promise<{ repo: string, product: string, environments: string[], tokenPolicy: object } | null>`
  - `createRelease(env, r: { repo, product, environment, sha, ref, runId: number, callbackUrl: string, installationId: number }) => Promise<{ id: string, created: boolean }>`
  - `listReleases(env, { state?: "pending" | "approved" | "rejected" | "expired" | "spent" }) => Promise<Release[]>`
  - `getRelease(env, id) => Promise<Release | null>`
  - `decideRelease(env, id, decision: "approved" | "rejected" | "expired", actor: string, note?: string) => Promise<Release>`
  - `spendRelease(env, match: { repo, environment, sha, runId: number }) => Promise<Release | null>`
  - `Release` = `{ id, repo, product, productName, environment, sha, ref, runId, state, note, createdAt, decidedAt, decidedBy, spentAt }`

- [ ] **Step 1:** Write the migration.
  - `release_repos(repo TEXT PRIMARY KEY, product TEXT NOT NULL REFERENCES products(slug), environments TEXT NOT NULL, token_policy TEXT NOT NULL DEFAULT '{}')`. `environments` is a JSON array.
  - `releases(id TEXT PRIMARY KEY, repo, product, environment, sha, ref, run_id INTEGER, callback_url, installation_id INTEGER, state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','expired','spent')), note, created_at, decided_at, decided_by, spent_at, UNIQUE (run_id, environment))`.
  - Seed rows for `oneloneraven/climbing-logbook` (production, beta, infra), `oneloneraven/deaftly-website` (production, beta, infra) and `oneloneraven/deaftly` (release), with `token_policy` left `{}` until Task 6.
- [ ] **Step 2: Write the failing tests.**
  - `createRelease` twice with the same `runId` and `environment` returns `created: false` the second time, and `listReleases` holds one.
  - `decideRelease` on a release that isn't `pending` throws `release-not-pending`.
  - `spendRelease` matches only an `approved` release with identical `repo`, `environment`, `sha` and `runId`. It sets `spent`, and a second call returns `null`.
  - Every decision writes an audit event, `release.approved`, `release.rejected` or `release.expired`, with `target_type` `release`.
- [ ] **Step 3:** Implement the registry and store. Ids come from `src/lib/ids.js`. `spendRelease` is one `UPDATE … WHERE state = 'approved' AND … RETURNING *`, so two concurrent spends can't both win.
- [ ] **Step 4:** Run `pnpm test test/releases-store.test.js`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 2: The protection-rule webhook

**Files:**
- Create: `src/releases/gate.js`
- Modify: `src/github/webhook.js` (dispatch on `X-GitHub-Event`), `src/discord.js` (add a `release` label)
- Test: `test/release-gate.test.js`

**Interfaces:**
- Consumes: `gatedRepo` and `createRelease` from Task 1, and `notifyNew` from `src/discord.js`.
- Produces: `handleProtectionRule(env, payload) => Promise<Response>`

- [ ] **Step 1: Write the failing tests.** Payload fields: `action: "requested"`, `environment`, `deployment_callback_url` (ending `/actions/runs/<run_id>/deployment_protection_rule`), `deployment.sha`, `deployment.ref`, `repository.full_name`, `installation.id`.
  - A registered repo and environment stores a pending release and pings Discord once: `**Release waiting** · Climbing Logbook` and `https://<ADMIN_HOST>/releases/<id>`.
  - An unregistered repo, or an environment the repo doesn't gate, returns 204 and stores nothing.
  - A redelivery stores nothing new and doesn't ping again.
  - A payload without a callback URL, or one whose `run_id` isn't a number, returns 400.
  - The signature check is the existing one: an unsigned request is a 401 before anything is parsed.
- [ ] **Step 2:** Implement. `webhook.js` routes `issues` to the existing logic, and `deployment_protection_rule` to `handleProtectionRule`. Every other event stays 204.
- [ ] **Step 3:** Run `pnpm test test/release-gate.test.js test/github.test.js`. Expected: PASS.
- [ ] **Step 4:** Commit.

### Task 3: Review: approve, reject and context

**Files:**
- Create: `src/releases/review.js`
- Modify: `src/admin/router.js`, `src/github/app.js` (export `call` as `githubCall`)
- Test: `test/releases-api.test.js`

**Interfaces:**
- Consumes: Task 1's store, and `installationToken` from `src/github/app.js`.
- Produces:
  - `GET /api/releases?state=` → `{ releases: Release[] }`
  - `GET /api/releases/:id` → `{ release: Release, pulls: { number, title, url }[], checks: { conclusion: "success" | "failure" | "pending", url } }`
  - `POST /api/releases/:id/approve` and `POST /api/releases/:id/reject`, with body `{ note?: string }` (at most 1,000 characters) → `{ release: Release }`
  - The counts gain `releasesWaiting: number`.

- [ ] **Step 1: Write the failing tests**, with `fetch` stubbed as the GitHub tests already do.
  - Approve POSTs to `/repos/<repo>/actions/runs/<runId>/deployment_protection_rule` with `{ environment_name, state: "approved", comment }` using an installation token, then marks the release `approved`.
  - Reject sends `state: "rejected"`.
  - A GitHub 422 or 404 marks the release `expired` and returns `{ error: "release-expired" }` with a 409.
  - A release that isn't pending is a 409 `release-not-pending`.
  - The detail lists the PRs from GitHub's compare between the last approved SHA for that repo and environment, and this one. With no earlier release, it lists none.
  - The checks are summarised from the run's `conclusion`.
- [ ] **Step 2:** Implement. The comment sent to GitHub is "Approved in Engage" or "Rejected in Engage", plus the note when there is one.
- [ ] **Step 3:** Run `pnpm test test/releases-api.test.js`. Expected: PASS.
- [ ] **Step 4:** Add the user-facing sentence for `release-expired` in `src/ui/errors.js`: "GitHub no longer waits on this run: start it again."
- [ ] **Step 5:** Commit.

### Task 4: Releases UI

**Files:**
- Create: `src/ui/pages/releases.js`
- Modify: `src/ui/main.js` (routes `/releases` and `/releases/:id`, one key), `src/ui/shell.js`, `src/ui/pages/home.js`, `src/ui/api.js`, `src/ui/styles.css`, `src/ui/format.js`
- Test: `e2e/admin.spec.js`, and `e2e/accessibility.spec.js` (adds "Releases" and "Release")

**Interfaces:**
- Consumes: Task 3's API.

- [ ] **Step 1: Write the failing e2e tests.**
  - With one pending release, the rail shows Releases with an attention badge of 1.
  - Home's verdict counts it and lists a row titled "Climbing Logbook <ref> is waiting to go to production", with Review and Approve release.
  - On `/releases/<id>`:
    - Approve release with a note marks it approved and it leaves the list.
    - Reject asks for confirmation inline before sending.
    - A 409 `release-expired` shows the sentence from Task 3.
- [ ] **Step 2:** Implement, following `docs/ui.md`.
  - The list is shaped like the inbox: product colour, repository, environment, version and time waiting.
  - The detail shows the PRs, a CI pill and a link to the run, then Approve release (the attention primary) and Reject (outlined).
  - The Releases rail entry appears only when the counts include `releasesWaiting`.
  - `verdict()` and `verdictSummary()` take `{ replyOwed, releasesWaiting }`.
- [ ] **Step 3:** Run `pnpm lint && pnpm typecheck && pnpm test`, then `pnpm test:e2e`. Expected: PASS, with axe passing in both themes at both widths.
- [ ] **Step 4:** Commit.

### Task 5: OIDC verification

**Files:**
- Create: `src/releases/oidc.js`
- Test: `test/oidc.test.js` (signs fixtures with a test RSA key, and stubs the JWKS fetch)

**Interfaces:**
- Produces: `verifyActionsToken(token: string, { audience: "engage", now?: number, fetchJwks? }) => Promise<{ repository, workflow_ref, ref, sha, environment, run_id: string, run_attempt: string }>`, which throws `oidc-invalid` with a reason that is logged, never returned to the caller.

- [ ] **Step 1: Write the failing tests.** Each of these throws:
  - a bad signature;
  - `alg` other than `RS256`;
  - the wrong `iss` (it must be `https://token.actions.githubusercontent.com`);
  - the wrong `aud`;
  - `exp` in the past, or `nbf` in the future (60 seconds of leeway);
  - an unknown `kid`.

  A good token returns the claims.
- [ ] **Step 2:** Implement it with `crypto.subtle.importKey("jwk", …, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" })`. Keys come from `https://token.actions.githubusercontent.com/.well-known/jwks`, cached for 10 minutes in module scope. An unknown `kid` refreshes the cache once.
- [ ] **Step 3:** Run `pnpm test test/oidc.test.js`. Expected: PASS.
- [ ] **Step 4:** Commit.

### Task 6: The credential broker

**Files:**
- Create: `src/releases/broker.js`
- Modify: `src/worker.js` (route `POST /v1/deploy-credentials` on the public host), `wrangler.jsonc` (an `ACCOUNT_LIMITER`-style `BROKER_LIMITER` at 30 a minute in every environment), `migrations/0007_release_token_policies.sql` (the real `token_policy` per repo)
- Test: `test/broker.test.js`

**Interfaces:**
- Consumes: `verifyActionsToken` from Task 5, and `spendRelease` and `gatedRepo` from Task 1.
- Produces: `POST /v1/deploy-credentials`, with `Authorization: Bearer <OIDC token>` → `200 { token, expiresAt }`, or 401, 403, 409 or 429, each `{ error }` with no detail.

- [ ] **Step 1: Write the failing tests.**
  - A valid token for an approved release returns a minted token. The Cloudflare `POST /accounts/<id>/tokens` body carries the repo's `token_policy` and `expires_on` 55 minutes ahead.
  - The release becomes `spent`, and an audit event `release.credential-minted` records the repo, environment and run, never the token.
  - A second call for the same run is a 409.
  - Claims that don't match any approved release are a 403, and nothing is minted.
  - A missing `CLOUDFLARE_BROKER_TOKEN` is a 503 `broker-not-configured`, and the event is logged.
- [ ] **Step 2:** Implement. The release is spent before the mint. If the mint then fails, the release goes back to `approved` and the caller gets a 502, so a retry can still succeed.
- [ ] **Step 3:** Run `pnpm test test/broker.test.js test/wrangler-previews.test.js`. Expected: PASS.
- [ ] **Step 4:** Update `docs/threat-model.md` (a new trust boundary: GitHub OIDC to Engage, and Engage to the Cloudflare token API), `docs/data-protection.md` (no personal data, stated) and ADR-0005, "Engage brokers deploy credentials".
- [ ] **Step 5:** Commit.

### Task 7: Turning it on

These are mostly owner steps, run from a runbook. The code change is small.

**Files:**
- Create: `docs/runbooks/release-gate.md`, `scripts/enable-release-gate.mjs`
- Test: `test/enable-release-gate.test.js` (with the GitHub API stubbed)

- [ ] **Step 1:** Write the runbook.
  1. In the App's settings, give it Deployments read and write and Actions read, and subscribe it to "Deployment protection rule". The owner accepts the new permissions on the installation.
  2. For each row in `release_repos`, `scripts/enable-release-gate.mjs` calls `POST /repos/{repo}/environments/{env}/deployment_protection_rules` with the App's `integration_id`, using a token the owner supplies at run time. Nothing is stored.
  3. Create `CLOUDFLARE_BROKER_TOKEN` (permission: create account API tokens) as an Engage Worker secret through the Sync Worker secrets workflow.
  4. Engage's own `production` environment gets the owner as a required reviewer.
  5. Break-glass: deploy Engage by hand with `wrangler deploy --env production` from a clean checkout of the release tag.
- [ ] **Step 2:** Write the script with a dry-run flag (the default) that prints what it would change. Test the request shapes.
- [ ] **Step 3:** Commit.

### Task 8: Bootstrap and product repositories (in `oneloneraven/project-bootstrap` and each product)

Tracked as issues in those repositories, not built here.
- In the `cloudflare-opentofu` templates (`deploy.yml`, `deploy-beta.yml`, `promote.yml`, the `infra.yml` apply) and the `android-toolchain` release template: add `permissions: id-token: write` and a step that exchanges the OIDC token at `https://engage-api.oneloneraven.com/v1/deploy-credentials`, exporting `CLOUDFLARE_API_TOKEN` for the job.
- Remove `CLOUDFLARE_DEPLOY_TOKEN` and `CLOUDFLARE_INFRA_APPLY_TOKEN` from new repositories. Each existing product repository gets the change and has the secrets deleted, once its first brokered deploy works.
