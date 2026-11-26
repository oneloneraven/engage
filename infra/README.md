# Infrastructure

Everything provisionable is managed here with [OpenTofu](https://opentofu.org), the open-source fork of Terraform (same HCL, providers and state format): DNS, TLS and HSTS,
DNSSEC, CAA, security headers and cache rules for `oneloneraven.com`, the
placeholder records for Engage's two hosts, `engage.` and `engage-api.`. The
admin Access application and policy, and the Turnstile widget for web
feedback on the product sites, are managed in the central identity stack,
coraxia. The apex is
never Engage's: it carries the Proton mail records. The
Worker itself is deployed by wrangler from the release workflows. The only
things outside OpenTofu are the state bucket (it must exist before OpenTofu
can use it), Worker runtime secrets and the CI credentials below.

State lives in the R2 bucket `engage-tfstate`, never in git.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `infra.yml` | PR touching `infra/` (plan); push to `main` (apply); manual | Format check, validate, plan; refuses any plan that deletes or replaces unless run by hand with `allow_deletes` ([Deleting resources](#deleting-resources)). Skips the repository's first push, before credentials exist |
| `bootstrap-state.yml` | Manual | Creates the state bucket if it's missing; safe to re-run |
| `preview.yml` | PR | Creates and migrates the PR's own D1 database `engage-pr-<n>`, uploads a Preview named `pr-<n>` bound to it and comments its URL; deletes both when the PR closes |
| `deploy.yml` | `v*` tag | Deploys the tag (to beta when the project has one, otherwise production) |
| `promote.yml` | Manual, with a tag | Deploys a released tag to production (beta projects only) |

## Setup

1. The zone `oneloneraven.com` is active on Cloudflare.
2. Create the CI tokens below, the R2 state credentials, and the GitHub
   secrets and variables: `node <plugin>/skills/bootstrap/scripts/secrets.mjs cloudflare-tokens <project dir>`
   does the CI tokens, or follow this page by hand.
3. Run "Bootstrap OpenTofu state bucket".
4. Run "Infra" (dispatch it, or merge a change under `infra/`).
5. Wait for DNSSEC to go live. The domain is on Cloudflare Registrar, which
   adds the DS record to the registry itself from the zone's CDS records,
   within one to two days. It's live when the zone's DNSSEC status is
   `active`.
6. In the dashboard, check the Worker's Preview URLs setting is on.

### Cloudflare API tokens

Create each as an account-owned token with a one-year expiry, scoped to this
account and, for zone permissions, to `oneloneraven.com` only.

| Token | GitHub secret | Permissions |
|---|---|---|
| Preview | `CLOUDFLARE_PREVIEW_TOKEN` (repository) | Account: Individual Workers Editor (the `engage-preview` Worker only), Account Settings Read, D1 Edit |
| Deploy | `CLOUDFLARE_DEPLOY_TOKEN` (environments `production`, and `beta` if used) | Account: Individual Workers Editor (the `engage-production` Worker only), Account Settings Read, Workers Scripts Read, D1 Edit. Zone: Workers Routes Edit |
| Infra plan | `CLOUDFLARE_INFRA_PLAN_TOKEN` (repository) | Account: Workers R2 Storage Read, Transform Rules Read, D1 Read. Zone: DNS Read, Zone Settings Read, Zone WAF Read, Cache Settings Read, Single Redirect Read |
| Infra apply | `CLOUDFLARE_INFRA_APPLY_TOKEN` (environment `infra`) | Account: Workers R2 Storage Edit, Transform Rules Edit, D1 Edit. Zone: DNS Edit, Zone Settings Edit, Zone WAF Edit, Cache Settings Edit, Single Redirect Edit |

Workers Scripts Read is account-scoped too, so the Deploy token can read every Worker's code and settings in the account, but not its secrets. Wrangler needs it to deploy a Worker whose last change didn't come from Wrangler (a secret or setting changed through the API or the dashboard). In that case, before uploading, it reads the Worker's routes through an account endpoint that neither Individual Workers Editor nor Workers Routes Edit can read (cloudflare/workers-sdk#16390).

Transform Rules is account-scoped, so the infra tokens' Transform Rules permission covers every zone in the account, not just `oneloneraven.com`.

If a plan or apply fails with an authorisation error, the error names the
missing permission: add exactly that one.

The Preview and Deploy tokens can edit only this project's own Workers, named
by Wrangler environment: `engage-preview` and `engage-production` (the name in
`wrangler.jsonc` plus the environment). A token can only be scoped to a Worker
that exists, and scoping names the Worker by its tag, not its name.

Never add a per-Worker granular policy to an existing token by editing it in
place: such writes have failed or silently left a token with no policies.
Create a new token instead. Check a token's real contents with
`GET /accounts/<account id>/tokens/<token id>`, not the dashboard labels.

### R2 state credentials

`node <plugin>/skills/bootstrap/scripts/secrets.mjs cloudflare-r2 <project dir>` creates both and sets the secrets. By hand, create two R2 API tokens (R2 → Manage R2 API Tokens), both limited to the
`engage-tfstate` bucket:

| Token | Permission | GitHub secrets |
|---|---|---|
| State read-write | Object Read & Write | `TF_STATE_ACCESS_KEY_ID`, `TF_STATE_SECRET_ACCESS_KEY` (environment `infra`) |
| State read-only | Object Read only | `TF_STATE_READ_ACCESS_KEY_ID`, `TF_STATE_READ_SECRET_ACCESS_KEY` (repository, for PR plans) |

PR plans run with the read-only pair, so code in a pull request can't
rewrite state.

### OpenTofu version

`infra.yml` pins OpenTofu exactly in `tofu_version`. Dependabot doesn't bump
it. To upgrade, take the newest `opentofu/opentofu` release that is more than
72 hours old (not a pre-release), change `tofu_version`, and run the same
version locally.

### Variables

`CLOUDFLARE_ACCOUNT_ID` as a repository variable. It isn't confidential.

The admin Access application and policy are managed in coraxia, so this
stack no longer needs `OWNER_EMAIL` as a repository secret or
`ACCESS_LOGIN_METHOD_ID` as a repository variable. Both can be deleted from
the repository's Actions secrets and variables once the policy deletion has
applied. The Worker's own `OWNER_EMAIL` runtime secret is separate and stays.

### Access

The admin host accepts only one login method: signing in with a Cloudflare
account, which brings that account's MFA. coraxia pins that method, so
adding another login method to the account, such as a one-time PIN, never
opens the admin host to it. Keep the Cloudflare account that `OWNER_EMAIL`
names on passkey or security-key 2FA only: an authenticator-app code can be
phished. Sessions last 8 hours, with the binding, HttpOnly and SameSite
cookie protections on. The Access application and its policy live in the
central identity stack, coraxia; the audience tag is committed in `wrangler.jsonc` as
`ACCESS_AUD`.

### Preview databases

Each PR's Preview gets its own D1 database, `engage-pr-<number>`, so unmerged
code never runs against production data. The Preview workflow creates it if
it's missing, applies the migrations, and writes a temporary
`.wrangler-preview.jsonc` (never committed) that points the Preview's `DB`
binding at it. `wrangler.jsonc` leaves `database_id` empty in `preview` and
`previews` for that reason. When the PR closes, merged or not, the workflow
deletes the database. Dependabot PRs get no Preview and no database.

D1 Write is an account-wide permission: Cloudflare can't scope it to one
database. The Preview token can read, change and delete every D1 database in
the account, production's included, so it stays a repository secret that only
the Preview workflow uses.

### Worker secrets

`OWNER_EMAIL` and `TURNSTILE_SECRET_KEY` reach the production Worker one
way. Each is stored as a secret of the `production` environment on GitHub,
and the manual "Sync Worker secrets" workflow sets it on the Worker from
there. The workflow runs on `main` only, passes each secret through the
environment and pipes it on stdin, fails when one is empty, and never prints
it. To set or change either:

1. Run `gh secret set <NAME> --env production`, which prompts for the value
   with hidden input.
2. Run "Sync Worker secrets" on `main`.
3. Check that `pnpm exec wrangler secret list --env production` lists it.

`TURNSTILE_SECRET_KEY` comes from the `engage-intake` widget, which lives in
the central identity stack, coraxia: read it on the widget's Turnstile page
in the Cloudflare dashboard. To rotate it, run coraxia's "Rotate a Turnstile
widget secret" with the widget's sitekey, then set the new value as above.
The sitekey isn't secret: it is `TURNSTILE_SITEKEY` in the production vars,
coraxia's `widget_sitekey` output, and it goes in each product's feedback
form. `verifyTurnstile` (`src/lib/turnstile.js`) refuses every token while
the secret or the sitekey is missing.

Set every other runtime secret once per environment with
`pnpm exec wrangler secret put <NAME> --env <env>`. Setting one environment
never sets another. Local development reads them from `.dev.vars`, which is
gitignored.

## Disaster recovery

1. Run "Bootstrap OpenTofu state bucket".
2. Run "Infra" to recreate everything managed here.
3. Run "Sync Worker secrets" on `main`, and set the other Worker secrets
   again, per environment.
4. Redeploy the latest release: run "Deploy" from its tag (and "Promote to
   production" where there's a beta).

## Deleting resources

`infra.yml` refuses a plan that deletes or replaces anything, so a merge that
removes a resource fails its apply and changes nothing. To apply it on
purpose, read the failed run's plan, then run "Infra" by hand on `main` with
`allow_deletes` ticked. It runs in the `infra` environment, so only `main` can
do it. Resources with `prevent_destroy` still refuse: removing that is the
teardown below.

## Teardown

Deliberately deleting the project's infrastructure:

1. Remove `prevent_destroy` from every resource in a PR (the infra workflow
   refuses plans that delete, so run the destroy locally).
2. Locally, with the infra apply token and state credentials in your
   environment:
   `tofu init -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"`
   then `tofu destroy`.
3. Delete the Workers: `pnpm exec wrangler delete --env <env>` for each
   environment.
4. Empty and delete the `engage-tfstate` bucket in the dashboard.
5. Revoke the four Cloudflare tokens and the R2 credentials.
6. Wait for the zone's DNSSEC status to go from `pending-disabled` to
   `disabled`, which means the DS record has left the registry. Cloudflare
   Registrar is expected to remove it automatically; if the status stays
   `pending-disabled`, turn DNSSEC off in the domain's Registrar settings.
