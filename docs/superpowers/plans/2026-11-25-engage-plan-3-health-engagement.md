# Engage Plan 3: Health and Engagement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each product panel on Home shows whether the product is healthy, one engagement number with a 30-day sparkline and its change on last month, and whether beta is ahead of production. Failing health joins Needs you.

**Architecture:** Two cron jobs gather everything into D1, and the admin API only reads D1, so Home never waits on a third party. A five-minute job reads Better Stack monitors and open incidents into `health_state`, and each environment's health endpoint into `deployed_versions`. The existing daily job also writes one row per product per metric into `metric_snapshots`, from a plug-in chosen in the registry. `GET /api/counts` gains a `signals` block per product, and the Home panels and Needs you render it.

**Tech Stack:** Cloudflare Workers Cron Triggers, D1, the Better Stack Uptime API, the Cloudflare GraphQL Analytics API, the GitHub REST API through the existing App (`githubCall` in `src/github/app.js`), and vanilla JS UI on the Ember direction (`docs/ui.md`).

**Spec:** `docs/superpowers/specs/2026-11-12-engage-design.md` §4.2 (registry), §7 (Home), §8 (Health and engagement), §10 (Security summary). UI: `docs/ui.md` (Home: Your products, and Components: Health pill).

## What the products have today

The plan is shaped by what exists, checked on 25 November 2026:

| Signal | Climbing Logbook | Deaftly |
|---|---|---|
| Better Stack monitors | Three: home page, app, beta (`infra/uptime.tf`) | None |
| Grafana Cloud alerts | Not set up yet (CL #1521 is open) | None |
| Version per environment | `GET /-/api/health/ready` returns `{ ok, version }` on `my.` and `beta.` (`server/api/health.js`); `version` is the Worker's version tag | `GET /api/health` on deaftly.com returns `{ ok, environment, version }` (`deaftly-website/src/worker.js`); no beta |
| Beta as its own GitHub environment | No: `deploy.yml` deploys beta inside the `production` job, so GitHub deployments can't tell them apart | No beta |
| Accounts | `GET /-/api/admin/usage` on the admin host (`server/api/admin-usage.js`); Access accepts only the owner's email today (`server/lib/access.js`) | No accounts |
| Web visits | Web Analytics with EU visitors excluded (CL ADR-0015) | To confirm in the dashboard |
| Android downloads | — | GitHub Release assets on `oneloneraven/deaftly` (`release-artefacts.yml` uploads `deaftly-<version>.apk`) |

Three consequences, all design calls recorded here:
- **Grafana is left out of this plan.** There's nothing to read yet. The health module takes a list of sources, so a Grafana source is one more module once CL #1521 lands.
- **Beta against production reads each environment's health endpoint**, not GitHub deployments. Design §8 allows either, and only the endpoints can tell CL's beta from its production.
- **A product with no monitors shows "Not monitored", never "Healthy".** Deaftly shows that until it has monitors.

## Global Constraints

- Home and the admin API never call a third party while rendering. Everything comes from D1, written by the cron jobs.
- Snapshots are aggregates with no personal data, and are kept indefinitely (§8). Health state stores a status, a one-line reason and a link, never an incident's free text.
- Web visits are always labelled "excludes EU visitors" wherever the number appears (§8, CL ADR-0015).
- Monitor alerts keep going to Discord from Better Stack as now. Engage sends no health pings (§8: light touch).
- Secrets live in Worker secrets, never in registry rows (§4.2): `BETTER_STACK_TOKEN`, `CLOUDFLARE_ANALYTICS_TOKEN` (Account Analytics: Read only), `CL_USAGE_CLIENT_ID` and `CL_USAGE_CLIENT_SECRET`. `CLOUDFLARE_ACCOUNT_ID` already exists.
- A source that isn't configured, or whose secret is missing, is skipped and logged once per run. It never fails the other sources.
- The beta badge goes amber after 7 days, from `products.beta_amber_days` (default 7) (§7: configurable).
- UI copy and colours follow `docs/ui.md`: health pill words are Healthy, Degraded, Failing, plus "Not monitored" and "Unknown"; sentence case; no blue.

## Review Focus

1. **Better Stack unreachable, or the token revoked.** Expect the panel to say "Unknown" with when it was last checked, and no Needs you row. An outage at the monitor must not read as an outage of the product. *(Task 1 test.)*
2. **Health state that has gone stale because the cron stopped.** Older than 15 minutes, expect "Unknown, last checked 40 minutes ago", never the last good word. *(Task 4 test.)*
3. **A paused monitor, or one in maintenance.** Expect it to be left out of the verdict, so pausing the beta monitor doesn't turn CL Degraded. *(Task 1 test.)*
4. **The first days after launch, with fewer than 30 snapshots.** Expect a sparkline of what exists and no change figure until there are two comparable points, rather than "up 100%" from zero. *(Task 3 and Task 4 tests.)*
5. **A beta health endpoint that's down while production is up.** Expect the beta badge to keep the last version seen with its age, and the beta monitor to drive health. A failed probe must not reset "since". *(Task 2 test.)*

---

## File structure

| File | Responsibility |
|---|---|
| `migrations/0007_health.sql` | `products.health_sources` and the `health_state` table |
| `migrations/0008_versions.sql` | `products.environments`, `products.beta_amber_days` and the `deployed_versions` table |
| `migrations/0009_metrics.sql` | `products.engagement` and the `metric_snapshots` table |
| `src/signals/health.js` | Reads Better Stack and writes `health_state` |
| `src/signals/versions.js` | Probes each environment's health endpoint and writes `deployed_versions` |
| `src/signals/metrics.js` | Runs each product's engagement plug-ins and writes `metric_snapshots` |
| `src/signals/sources/` | One module per engagement plug-in: `web-visits.js`, `cl-usage.js`, `github-downloads.js` |
| `src/signals/read.js` | Builds the `signals` block the admin API returns |
| `src/worker.js`, `wrangler.jsonc` | Dispatches the two crons by `controller.cron` |
| `src/admin/items.js` | `counts` gains `signals` per product and `healthFailing` |
| `src/ui/pages/home.js`, `src/ui/format.js`, `src/ui/sparkline.js` | Panels, Needs you health rows, verdict |
| `docs/runbooks/health-and-engagement.md` | Secrets and registry config, for the owner |

### Task 1: Health from Better Stack (#111)

**Files:**
- Create: `migrations/0007_health.sql`, `src/signals/health.js`
- Modify: `src/worker.js`, `wrangler.jsonc` (production and preview crons)
- Test: `test/signals-health.test.js`, `test/worker.test.js`

**Interfaces:**
- Produces:
  - `products.health_sources TEXT NOT NULL DEFAULT '{}'`: `{ "betterStack": { "monitors": [{ "id": string, "name": string, "url": string }] } }`. `url` is the link out (the monitor page, or the status page).
  - `health_state (product TEXT PRIMARY KEY REFERENCES products(slug), status TEXT NOT NULL CHECK (status IN ('healthy','degraded','failing','unmonitored','unknown')), reason TEXT, link TEXT, checked_at TEXT NOT NULL)`
  - `refreshHealth(env, now: Date) => Promise<void>`
  - `scheduled` dispatches `"*/5 * * * *"` to `refreshHealth` and `refreshVersions` (Task 2), and `"17 3 * * *"` to retention and `snapshotMetrics` (Task 3).

- [ ] **Step 1: Write the failing tests** with Better Stack's two calls stubbed through an injected `fetch`:
  - all monitors `up`, no open incidents → `healthy`, reason `null`
  - one monitor `down` → `failing`, reason `"Climbing Logbook app is down"`, link that monitor's `url`
  - one `validating` → `degraded`, reason `"Climbing Logbook beta is recovering"`
  - an open incident (`resolved=false`) on an `up` monitor → `degraded`, reason `"Open incident on Climbing Logbook app"`
  - `paused`, `pending` and `maintenance` monitors are left out; all left out → `unmonitored`
  - no `betterStack` config → `unmonitored`, and Better Stack isn't called
  - Better Stack 401 or network error → `unknown`, reason `"Couldn't reach Better Stack"`, and the previous row's status isn't kept
  - `test/worker.test.js`: each cron string calls only its own jobs
- [ ] **Step 2: Run** `pnpm vitest run test/signals-health.test.js test/worker.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** `GET https://incidents.betterstack.com/api/v2/monitors` (paged by `pagination.next`, `per_page=250`) and `GET https://incidents.betterstack.com/api/v5/incidents?resolved=false`, both with `Authorization: Bearer ${BETTER_STACK_TOKEN}`. Match incidents to monitors by `relationships.monitor.data.id`. Precedence: failing over degraded over healthy. One upsert per product. Log `health.checked` with the status only.
- [ ] **Step 4: Run** the tests. Expected: PASS. Then `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit.**

### Task 2: Beta against production (#112)

**Files:**
- Create: `migrations/0008_versions.sql`, `src/signals/versions.js`
- Test: `test/signals-versions.test.js`

**Interfaces:**
- Produces:
  - `products.environments TEXT NOT NULL DEFAULT '[]'`: `[{ "name": "production" | "beta", "healthUrl": string }]`
  - `products.beta_amber_days INTEGER NOT NULL DEFAULT 7`
  - `deployed_versions (product TEXT NOT NULL REFERENCES products(slug), environment TEXT NOT NULL, version TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY (product, environment))`
  - `refreshVersions(env, now: Date) => Promise<void>`

- [ ] **Step 1: Write the failing tests:**
  - a new version on an environment → `first_seen = last_seen = now`
  - the same version again → only `last_seen` moves
  - a probe that fails, times out (3 s) or returns no string `version` → the row is untouched
  - a `version` longer than 64 characters, or outside `[A-Za-z0-9._+-]`, is refused (it's shown in the UI)
  - a product with no environments → no fetch
- [ ] **Step 2: Run** `pnpm vitest run test/signals-versions.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** with `fetch(healthUrl, { signal: AbortSignal.timeout(3000) })` and an upsert that sets `first_seen` only when `version` changes.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: Engagement snapshots (#113)

**Files:**
- Create: `migrations/0009_metrics.sql`, `src/signals/metrics.js`, `src/signals/sources/web-visits.js`, `src/signals/sources/cl-usage.js`, `src/signals/sources/github-downloads.js`
- Test: `test/signals-metrics.test.js`

**Interfaces:**
- Produces:
  - `products.engagement TEXT NOT NULL DEFAULT '[]'`: `[{ "source": "web-visits" | "cl-usage" | "github-downloads", "metric": string, "label": string, "primary": boolean, ...sourceConfig }]`. Exactly one entry is `primary`; it's the panel's number.
  - `metric_snapshots (product TEXT NOT NULL REFERENCES products(slug), metric TEXT NOT NULL, day TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (product, metric, day))`
  - Each source: `(env, config, day: string) => Promise<number>`, where `day` is the UTC date being recorded (yesterday).
  - `snapshotMetrics(env, now: Date) => Promise<void>`
- Source contracts:
  - **`web-visits`** (`{ siteTag, metric: "visits", label: "Visits, excluding EU visitors" }`): Cloudflare GraphQL, `viewer.accounts(filter: { accountTag })`, `rumPageloadEventsAdaptiveGroups(filter: { siteTag, date: day }, limit: 1) { sum { visits } }`, with `CLOUDFLARE_ANALYTICS_TOKEN`. Probe the field names against the live schema before writing the query; they're unconfirmed.
  - **`cl-usage`** (`{ url, field: "activeUsers", metric: "active-users", label: "People who logged a climb in the last 30 days" }`): `GET url` with `CF-Access-Client-Id` and `CF-Access-Client-Secret` from the two `CL_USAGE_*` secrets; returns the named integer field. Needs the CL change in Task 6.
  - **`github-downloads`** (`{ repo, assetPattern: "\\.apk$", metric: "downloads", label: "Android downloads" }`): every page of `GET /repos/{repo}/releases` through `githubCall`, summing `download_count` over matching assets. Stored as the cumulative total; the read side turns it into downloads per day.

- [ ] **Step 1: Write the failing tests:**
  - one row per product per metric for yesterday's UTC date; running twice the same day overwrites, not duplicates
  - one source throwing still records the others, and logs `metrics.source-failed` with the source name
  - a missing secret skips that source without calling it
  - `web-visits` sends `siteTag` and `day` and reads `sum.visits`; a GraphQL `errors` array throws
  - `cl-usage` sends both Access headers and rejects a non-integer field
  - `github-downloads` follows `Link: rel="next"` and counts only matching assets
  - `snapshotMetrics(env, now, { backfillDays: 30 })` writes 30 days for `web-visits` only, since the other two can't look back
- [ ] **Step 2: Run** `pnpm vitest run test/signals-metrics.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the three sources and the runner, with a source map keyed by `source`. An unknown `source` is logged and skipped.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: Home shows health, engagement and beta (#114)

**Files:**
- Create: `src/signals/read.js`, `src/ui/sparkline.js`
- Modify: `src/admin/items.js` (`counts`), `src/ui/pages/home.js`, `src/ui/format.js`, `src/ui/styles.css`, `e2e/fixtures.js`
- Test: `test/signals-read.test.js`, `test/admin-api.test.js`, `test/ui-format.test.js` (new: `format.js` is pure), `e2e/admin.spec.js`, `e2e/accessibility.spec.js`

**Interfaces:**
- Consumes: the three tables from Tasks 1–3.
- Produces:
  - `readSignals(env, now: Date) => Promise<Record<string, Signals>>`, where `Signals` is
    `{ health: { status, reason, link, checkedAt }, engagement: { label, value, series: { day, value }[], change: number | null } | null, beta: { version, production, since, amber: boolean } | null }`
  - `counts(env)` adds `signals` to each product and `healthFailing: number` (products whose status is `failing` or `degraded`).
  - `verdict` and `verdictSummary` in `format.js` take `healthFailing = 0` beside `replyOwed` and `releasesWaiting`.
- Read rules:
  - health older than 15 minutes is returned as `unknown`, reason `"Last checked <n> minutes ago"`
  - `series` is the last 30 days of the primary metric; for `github-downloads` it's the daily difference of the cumulative total, floored at 0
  - `change` compares the sum of the last 30 days with the 30 before; `null` unless both windows have at least 25 days (for rolling metrics like `active-users`: today's value against the value 30 days ago, `null` if that day is missing). Rounded to whole percent.
  - `beta` is `null` unless the product has both environments and their versions differ; `amber` when `since` is more than `beta_amber_days` ago

- [ ] **Step 1: Write the failing tests** for `readSignals` (each read rule above, including stale health, fewer than 25 days, and a downloads total that went down) and for `GET /api/counts` carrying `signals` and `healthFailing`.
- [ ] **Step 2: Run** `pnpm vitest run test/signals-read.test.js test/admin-api.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `readSignals` and the `counts` change.
- [ ] **Step 4: Write the failing UI tests:**
  - `verdict({ healthFailing: 1 })` counts it; `verdictSummary` says "Climbing Logbook is failing" (one product) or "2 products need a look"
  - the panel shows the health pill (`docs/ui.md`: dot plus word), the number with its label, the sparkline, "up 12% on last month" / "down 4% on last month" / nothing when `change` is `null`, and the beta badge "Beta v1.15.0, 3 days ahead of production"
  - Needs you gains one row per failing or degraded product, linking to `health.link` with "Open in Better Stack"
  - e2e: Home with a failing product, a stale one, an amber beta badge and an empty series; axe at both widths in both themes
- [ ] **Step 5: Implement** the panel per `docs/ui.md` "Your products", replacing the placeholder note there. `sparkline(points: number[], label: string) => SVGElement`: an inline SVG polyline in the product colour, `role="img"` with an `aria-label` that states the first and last values, and no chart library. "Not monitored" and "Unknown" use the neutral dot.
- [ ] **Step 6: Run** `pnpm lint && pnpm typecheck && pnpm test` and the e2e suite in CI. Expected: PASS.
- [ ] **Step 7: Commit.**

### Task 5: Turning it on (#115)

**Files:**
- Create: `docs/runbooks/health-and-engagement.md`, `migrations/0010_signal_config.sql`
- Modify: `docs/threat-model.md`, `docs/data-protection.md`, `docs/ui.md`, `.github/workflows/sync-worker-secrets.yml` (one step per new secret, as for `OWNER_EMAIL`)

- [ ] **Step 1: Write the runbook** for the owner:
  - creating a Better Stack API token and setting `BETTER_STACK_TOKEN`
  - creating a Cloudflare token with Account Analytics: Read only, and setting `CLOUDFLARE_ANALYTICS_TOKEN`
  - finding each Web Analytics site tag, and confirming whether deaftly.com has Web Analytics on
  - CL's Access service token (Task 6) and the two `CL_USAGE_*` secrets
  - the one-off 30-day visits backfill
- [ ] **Step 2: Write `0010_signal_config.sql`** with the registry config that isn't secret: CL's three monitors (ids from `tofu output` or the API), both products' health endpoints, and each product's engagement entries. Site tags and monitor ids the plan can't know are filled in from the runbook before this migration merges.
- [ ] **Step 3: Update the docs:**
  - threat model: three new outbound credentials, and Engage now holds a CL Access service token, a new trust boundary into CL's admin host, scoped by CL to one path
  - data protection: snapshots are aggregates with no personal data, kept indefinitely; no new processor for personal data
  - `docs/ui.md`: drop "Until Module 3 lands…" from "Your products"
- [ ] **Step 4: Commit.**

### Task 6: Climbing Logbook lets Engage read usage (oneloneraven/climbing-logbook#1728)

**Files (CL):** `server/lib/access.js`, `server/api/admin.js`, `infra/` (the admin Access application), tests.

- [ ] **Step 1: Write the failing tests** in CL:
  - an Access JWT from the Engage service token (its `common_name` equals the configured `ENGAGE_USAGE_CLIENT_ID`) passes for `GET /-/api/admin/usage` only
  - the same token gets 403 on every other admin route and method
  - an owner-email JWT still passes everywhere, as now
- [ ] **Step 2: Implement** a second allowed identity in `verifyAccessRequest`, limited by route in `admin.js`. Fail closed when `ENGAGE_USAGE_CLIENT_ID` is unset.
- [ ] **Step 3: Add** a `cloudflare_zero_trust_access_service_token` and a service-auth policy on the admin application in `infra/`. The token's id and secret go to Engage's secrets, not CL's.
- [ ] **Step 4: Update** CL's threat model and ADR-0034's consequences.
- [ ] **Step 5: Commit** on its own branch and PR in CL.

## Order

Tasks 1, 2, 3 and 6 are independent. Task 4 needs 1–3. Task 5 needs 1–3 merged, and its migration needs the owner's runbook steps. The CL piece (6) only blocks CL's active-users number, which shows as "No data yet" until then.

## Left out, on purpose

- Grafana Cloud alert state, until CL #1521 sets alerting up.
- Better Stack monitors for Deaftly: oneloneraven/deaftly-website#102.
- Play Store and App Store statistics (§8, §12).
- Health pings to Discord. Better Stack already sends them (§8).
