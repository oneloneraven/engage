# Turning on the release gate

Engage's release gate makes every product deploy to a gated environment wait for your approval, and its broker hands deploy jobs a short-lived Cloudflare token for approved runs only ([ADR-0008](../adr/0008-engage-brokers-deploy-credentials.md), design §6). These steps are yours: they grant permissions or create credentials.

Do them in order. Until step 4, deploys keep using their GitHub-held tokens and nothing changes for them.

## 1. Check the App's permissions

`oneloneraven-engage` was created with Deployments (read and write), Actions (read) and the **Deployment protection rule** event ([github-app.md](github-app.md)). Confirm it in the App's settings. If GitHub shows a banner asking the organisation to accept new permissions, accept it.

## 2. Create the broker's parent token and secrets

1. In the Cloudflare dashboard, create an **account API token** whose only permission lets it create account API tokens (the API Tokens write permission at account level; check the name the dashboard shows). Give it no other permission.
2. Store it in Proton Pass as `Dev / engage / Engage broker parent token`.
3. Set two production Worker secrets, through the **Sync Worker secrets** workflow or with `wrangler secret put … --env production`:
   - `CLOUDFLARE_BROKER_TOKEN`: the token from step 1.
   - `CLOUDFLARE_ACCOUNT_ID`: the account id.

Treat this token as Engage's most sensitive secret: whoever holds it can mint tokens for the whole account.

## 3. Write each repository's token policy

The broker mints tokens from the `policies` stored for each repository in `release_repos.token_policy`. It refuses to mint (503, logged as `broker.no-token-policy`) until a policy exists.

1. List permission group ids: `GET https://api.cloudflare.com/client/v4/accounts/<account id>/tokens/permission_groups`.
2. For each repository, give it only what its deploy needs. That's usually **Workers Scripts: Edit** and **D1: Edit**, limited to the account, plus **Workers Routes: Edit** on its own zone.
3. Add the policies in a migration, so they're reviewed:

```sql
UPDATE release_repos SET token_policy = '{"policies":[{"effect":"allow","resources":{"com.cloudflare.api.account.<account id>":"*"},"permission_groups":[{"id":"<workers scripts edit>"},{"id":"<d1 edit>"}]}]}'
WHERE repo = 'oneloneraven/climbing-logbook';
```

The `infra` environment's apply token needs wider permissions than a deploy. Give it the same groups as the repository's current `CLOUDFLARE_INFRA_APPLY_TOKEN`, and no more.

## 4. Add Engage's protection rule to each environment

```bash
node scripts/enable-release-gate.mjs
```

The script runs as you through `gh`. It reads the gated repositories from production's `release_repos` and prints, for each environment, whether it would add Engage's rule. Nothing changes until you add `--apply`:

```bash
node scripts/enable-release-gate.mjs --apply
```

From then on, every deploy to those environments waits under **Releases** in Engage, and you get a Discord ping. Approving it lets the job run. The job still uses its GitHub-held token until step 5.

## 5. Switch each repository to the broker

Follow oneloneraven/project-bootstrap#147 for each product repository:
1. Its deploy and infra jobs exchange their OIDC token at `https://engage-api.oneloneraven.com/v1/deploy-credentials`.
2. After the first brokered deploy works, delete the repository's `CLOUDFLARE_DEPLOY_TOKEN` and `CLOUDFLARE_INFRA_APPLY_TOKEN` secrets, and revoke those tokens in Cloudflare.

## Engage's own deploys

Engage doesn't gate itself, because a broken Engage would block the fix that repairs it.
- **Required reviewer:** in `oneloneraven/engage`'s settings, under **Environments → production**, add yourself as a required reviewer.
- **Break-glass deploy:** if Engage is broken and the workflow can't run, deploy the last good tag by hand from a clean checkout:

```bash
git checkout v<last good version> && pnpm install --frozen-lockfile && pnpm build && pnpm exec wrangler deploy --env production
```

## When a run waits too long

GitHub stops waiting on a run after 30 days. Approving a run GitHub no longer waits on marks the release **expired** in Engage: start the job again from GitHub, and a new release appears.
