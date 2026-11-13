# 1. Record architecture decisions

## Status

Accepted

## Context

Decisions buried in long-lived docs disappear as those docs are rewritten,
and decisions argued out in issues and PRs are hard to find later. Either
way the "why" is lost.

## Decision

Record significant decisions as Markdown ADRs in `docs/adr/`, in Nygard's
format, numbered sequentially. No tooling: plain files, rendered by GitHub.

Write one when a decision is hard to reverse, or when its reasoning isn't
obvious from the code. Routine feature work doesn't need one.

Accepted ADRs are never edited. A changed decision gets a new ADR that
supersedes the old one by reference.

## Consequences

- Decisions are written down when they're made, not reconstructed later.
- Docs describe the current state and link to ADRs for the reasons.
