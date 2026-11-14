# Working in Engage

One Lone Raven's control centre: feedback, email, releases and health across every product.

This file is an index. Each line is a rule; the linked doc has the detail.
Read a doc when the work touches it, not up front.

## Process

- Every change starts as a GitHub issue, then a branch, then a PR. Never commit to `main`: [workflow](docs/workflow.md).
- Branches are named by what the change does for users: `feature/`, `fix/`, `ci/`, `chore/`, `spike/`, `docs/`: [workflow](docs/workflow.md#branches).
- Open every PR as a draft with its `release:` label set at creation, then mark it ready: [versioning](docs/versioning.md).
- Work through the definition of done before marking a PR ready: [definition of done](docs/definition-of-done.md).
- Merge a PR yourself once it meets the definition of done and every required check passes, but ask the maintainer before merging one that cuts a release; this is standing approval for every other merge: [workflow](docs/workflow.md#pull-requests).
- Never force-push without asking first, every time. Update a pushed branch by merging `main`, not rebasing: [workflow](docs/workflow.md#git).
- Pace GitHub API mutations and never retry into a rate limit: [workflow](docs/workflow.md#github-api).
- Propose before building when there's an open design question; concrete fixes with clear direction go straight ahead: [workflow](docs/workflow.md#ways-of-working).
- Change only what was asked. Flag wider improvements and wait for an answer.

## Standards

- Code is reviewed against [coding standards](docs/coding-standards.md); hold it to the [engineering standards](.claude/skills/engineering-standards/SKILL.md).
- No comments by default; one line for a "why" the code can't express: [comments](docs/coding-standards.md#comments-and-docs).
- Privacy and data rules: [privacy](docs/privacy.md), [record of processing](docs/data-protection.md).
- Keep the [threat model](docs/threat-model.md) current whenever a trust boundary moves.
- Screen new dependencies and vendors: [ADR-0002](docs/adr/0002-screen-dependencies-against-bds-boycott-lists.md).
- Significant decisions get an [ADR](docs/adr/README.md).
- Verify before claiming anything works; report failures and unverified steps plainly.

## Working with Claude

- An Opus-class main session plans, decides and verifies; at most one Sonnet-class subagent does all delegated work, one at a time: [working with Claude](docs/working-with-claude.md).
- Memory is one fact per file with `MEMORY.md` as the index: [working with Claude](docs/working-with-claude.md#memory).

## Stack

- JavaScript with pnpm, Biome, `tsc` over JSDoc and Vitest: [coding standards](docs/coding-standards.md#javascript-toolchain). Run `pnpm lint && pnpm typecheck && pnpm test` before pushing.
- A browser app built with Vite and tested end to end with WebdriverIO in Chromium and Firefox (and Safari on macOS in CI for public repos), with axe-core checking WCAG 2.2 AA: [coding standards](docs/coding-standards.md#web-app).
- Cloudflare Workers, deployed by wrangler from release tags; infrastructure in OpenTofu: [coding standards](docs/coding-standards.md#cloudflare-and-opentofu), [infra](infra/README.md). Merging `infra/` is a production change.
