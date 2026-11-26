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
2. Create the CI tokens, the R2 state credentials, and the GitHub secrets
   and variables: `node <plugin>/skills/bootstrap/scripts/secrets.mjs cloudflare-tokens <project dir>`
   does the CI tokens. Their permissions are kept in the private vault.
3. Run "Bootstrap OpenTofu state bucket".
4. Run "Infra" (dispatch it, or merge a change under `infra/`).
5. Wait for DNSSEC to go live. The domain is on Cloudflare Registrar, which
   adds the DS record to the registry itself from the zone's CDS records,
   within one to two days. It's live when the zone's DNSSEC status is
   `active`.
6. In the dashboard, check the Worker's Preview URLs setting is on.

### Cloudflare API tokens

This section is kept in the private vault.

### R2 state credentials

This section is kept in the private vault.

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

This section is kept in the private vault.

### Preview databases

This section is kept in the private vault.

### Worker secrets

This section is kept in the private vault.

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
