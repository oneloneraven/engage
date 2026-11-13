# 2. Screen dependencies and vendors against BDS boycott lists

## Status

Accepted

## Context

Who maintains a dependency or runs a vendor, and what that organisation
does, is part of this project's values, not just its supply-chain risk.

## Decision

Before adopting a dependency or vendor of any weight (a non-trivial runtime
package, a hosting or platform vendor, an identity provider, a third-party
API), check it against the BDS movement's
[consumer boycott priority targets](https://bdsmovement.net/Guide-to-BDS-Boycott)
and its
[No Tech for Oppression, Apartheid or Genocide campaign](https://bdsmovement.net/no-tech-oppression-apartheid-or-genocide).

Record the check (dependency, maintainer, on a list or not) in the PR, ADR
or doc that records the adoption.

A hit is surfaced and weighed explicitly against the alternatives and their
costs. It is never skipped.

**Exception:** a free, industry-standard tool with no viable alternative is
allowed, because using it pays nothing to the listed company. Record it
where it's adopted.

No product or brand on either list is named or recommended in this
project's copy.

## Consequences

- Every new dependency or vendor carries a visible screening record.
- A clearance is a point-in-time result. Re-check a vendor before
  substantially expanding the relationship.
- This is a recorded manual check, not an automated gate: there's no
  machine-readable list to check against.

## Screening record

Checked at bootstrap for the project's default dependencies and vendors.

| Dependency | Maintainer | On a list | Note |
|---|---|---|---|
| GitHub (repository, Actions, Dependabot, Projects) | Microsoft | Y | Free tier, industry standard, no viable alternative: allowed under the free-tool exception. Nothing is paid. |
| pnpm | pnpm project (independent open source) | N |  |
| Vitest | VoidZero Inc. | N |  |
| Biome | Biome project (independent open source) | N |  |
| TypeScript (`tsc`) | Microsoft | Y | Free, dev-only, no maintained non-Microsoft JavaScript type checker: allowed under the free-tool exception. |
| Vite | VoidZero Inc. | N |  |
| axe-core | Deque Systems | N |  |
| WebdriverIO | OpenJS Foundation | N | Chosen over Playwright, whose maintainer Microsoft is a consumer boycott target. |
| Cloudflare (hosting, DNS, R2) | Cloudflare, Inc. | N |  |
| wrangler | Cloudflare, Inc. | N |  |
| OpenTofu | OpenTofu project (Linux Foundation) | N | Chosen over Terraform, whose owner IBM is a No Tech for Apartheid target. |
