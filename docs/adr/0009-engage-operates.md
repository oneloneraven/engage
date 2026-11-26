# 9. Engage operates; granting and watching move out

## Status

Accepted. Supersedes [ADR-0008](0008-engage-brokers-deploy-credentials.md).

## Context

One Lone Raven's central systems each have one job (project-bootstrap's [architecture](https://github.com/oneloneraven/project-bootstrap/blob/main/docs/architecture.md), its ADR-0008). Engage was set to hold the deploy-credential broker, whose parent secret can mint any Cloudflare API token, and to become the security watcher too. It is also the system with the most code, users' personal data, and public input (intake and inbound email). A compromised Engage could then deploy anything and hide that it had.

## Decision

- **Engage operates the products:** feedback, email, releases (the gate and the owner's approval), health and usage, product hubs, and conformance.
- **The broker moves to coraxia** (coraxia's ADR-0004).
  - Engage keeps the release gate and the approval click.
  - Engage passes the owner's Access token with the approval, so that coraxia can check the owner really approved.
  - Engage holds no token-minting secret.
- **Security checks, events and alerts belong to Guardian.** It's read-only, and its settings are on Cloudflare. Engage shows Guardian's results on `/repositories` and under Needs you, through Guardian's API, and holds no security baseline.
- **Conformance runs against a pinned bootstrap release,** not bootstrap's `main`.

## Consequences

- Engage's most sensitive secret is its GitHub App key, which only writes issues and deployments. The parent token-minting secret is no longer one of its secrets.
- `src/releases/broker.js` and `CLOUDFLARE_BROKER_TOKEN` go once coraxia's broker is live. No repository uses them today.
- A compromised Engage could misreport Guardian's results on its own pages, but it can't stop Guardian's alerts.
- Taking a new bootstrap standard is a deliberate change to Engage.
