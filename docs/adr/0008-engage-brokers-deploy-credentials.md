# 8. Engage brokers deploy credentials

## Status

Superseded by [ADR-0009](0009-engage-operates.md)

## Context

Every product repository holds long-lived Cloudflare deploy tokens as GitHub secrets. Anyone who controls the GitHub account, or a workflow file on the default branch, can deploy anything with them. Engage's release gate (design §6) makes deploys wait for the owner's approval, but approval alone is only a GitHub setting: remove the protection rule and the stored token still works.

## Decision

Deploy jobs get their Cloudflare credential from Engage, not from GitHub secrets.

- The job requests a GitHub Actions OIDC token with audience `engage`, and POSTs it to `https://engage-api.oneloneraven.com/v1/deploy-credentials`.
- Engage verifies the token's RS256 signature against GitHub's published keys, along with its issuer, audience and expiry. It then spends the approved release whose repository, environment, commit and run match the token exactly.
- Engage mints an account API token with the repository's `token_policy` from `release_repos`. It expires 55 minutes later and is returned once.
- The release is spent before the mint, and put back to approved if the mint fails. One approval yields one credential.
- The parent credential, `CLOUDFLARE_BROKER_TOKEN`, can only create account API tokens. It and `CLOUDFLARE_ACCOUNT_ID` are Worker secrets, read only by `src/releases/broker.js`.
- Every mint is audited as `release.credential-minted`, with the repository, environment, run and expiry, and never the token.

## Consequences

- Without the owner's approval in Engage there is no credential, even for someone who controls GitHub.
- Engage becomes a dependency of every product deploy. Engage doesn't gate its own deploys, and a break-glass runbook covers deploying it by hand.
- The parent credential is now Engage's most sensitive secret: whoever holds it can mint tokens for the whole account.
- PR previews keep their GitHub-held preview token, which is the accepted gap in design §6.
