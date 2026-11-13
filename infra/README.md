# Infrastructure

Everything provisionable is managed here with [OpenTofu](https://opentofu.org), the open-source fork of Terraform (same HCL, providers and state format): DNS, TLS and HSTS,
DNSSEC, CAA, security headers and cache rules for `oneloneraven.com`, and the
placeholder records for Engage's two hosts, `engage.` and `in.`. The apex is
never Engage's: it carries the Proton mail records. The
Worker itself is deployed by wrangler from the release workflows. The only
things outside OpenTofu are the state bucket (it must exist before OpenTofu
can use it), Worker runtime secrets and the CI credentials below.

State lives in the R2 bucket `engage-tfstate`, never in git.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `infra.yml` | PR touching `infra/` (plan); push to `main` (apply) | Format check, validate, plan; refuses any plan that deletes or replaces. Skips the repository's first push, before credentials exist |
| `bootstrap-state.yml` | Manual | Creates the state bucket if it's missing; safe to re-run |
| `preview.yml` | PR | Uploads a Preview named `pr-<n>` and comments its URL |
| `deploy.yml` | `v*` tag | Deploys the tag (to beta when the project has one, otherwise production) |
| `promote.yml` | Manual, with a tag | Deploys a released tag to production (beta projects only) |

## Setup

1. The zone `oneloneraven.com` is active on Cloudflare.
2. Create the CI tokens below, the R2 state credentials, and the GitHub
   secrets and variables: `node <plugin>/skills/bootstrap/scripts/secrets.mjs cloudflare-tokens <project dir>`
   does the CI tokens, or follow this page by hand.
3. Run "Bootstrap OpenTofu state bucket".
4. Run "Infra" (dispatch it, or merge a change under `infra/`).
5. Add the DS record from `tofu output app_dnssec_ds_record` at the
   registrar.
6. In the dashboard, check the Worker's Preview URLs setting is on.

### Cloudflare API tokens

Create each as an account-owned token with a one-year expiry, scoped to this
account and, for zone permissions, to `oneloneraven.com` only.

| Token | GitHub secret | Permissions |
|---|---|---|
| Preview | `CLOUDFLARE_PREVIEW_TOKEN` (repository) | Account: Workers Scripts Edit, Account Settings Read |
| Deploy | `CLOUDFLARE_DEPLOY_TOKEN` (environments `production`, and `beta` if used) | Account: Workers Scripts Edit, Account Settings Read. Zone: Workers Routes Edit |
| Infra plan | `CLOUDFLARE_INFRA_PLAN_TOKEN` (repository) | Account: Workers R2 Storage Read, Transform Rules Read. Zone: DNS Read, Zone Settings Read, Zone WAF Read, Cache Settings Read |
| Infra apply | `CLOUDFLARE_INFRA_APPLY_TOKEN` (environment `infra`) | Account: Workers R2 Storage Edit, Transform Rules Edit. Zone: DNS Edit, Zone Settings Edit, Zone WAF Edit, Cache Settings Edit |

Transform Rules is account-scoped, so the infra tokens' Transform Rules permission covers every zone in the account, not just `oneloneraven.com`.

If a plan or apply fails with an authorisation error, the error names the
missing permission: add exactly that one.

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

### Worker secrets

Set each runtime secret once per environment with
`pnpm exec wrangler secret put <NAME> --env <env>`. Setting one environment
never sets another. Local development reads them from `.dev.vars`, which is
gitignored.

## Disaster recovery

1. Run "Bootstrap OpenTofu state bucket".
2. Run "Infra" to recreate everything managed here.
3. Set the Worker secrets again, per environment.
4. Redeploy the latest release: run "Deploy" from its tag (and "Promote to
   production" where there's a beta).

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
6. Remove the DS record at the registrar.
