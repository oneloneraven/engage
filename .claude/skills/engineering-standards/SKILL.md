---
name: engineering-standards
description: How substantial engineering work gets done in this repo - scoping, sequencing, verification discipline, and the quality bar. Use when planning a multi-step feature or refactor, breaking work into epics or issues, executing a mechanical restructuring, or judging whether work is done well rather than just done.
---

# Engineering standards

## North star

Write code an experienced engineer would be proud of, not just code that
passes review. Apply SOLID, KISS, DRY, YAGNI, Tell-Don't-Ask, high cohesion
and low coupling while building, not only when reviewing. When a task's
honest scope is bigger than the cheapest thing to ship, say so and let the
owner choose. Never silently narrow the scope to the easy part.

## Scoping multi-step work

- Ground scope in the current code, not memory. Read the real files and cite
  real names and lines before writing an epic or issue.
- Decompose along genuine single-responsibility boundaries.
- Sequence dependencies explicitly: what lands first, what can go in any
  order.
- State what's out of scope, and why.
- Write acceptance criteria that can be checked against the repo.
- When new work shows an earlier decision was wrong, update that issue for
  the record.

## Delivering multi-step work

- One focused PR per coherent slice. Group only small, related pieces.
- For a sequential epic, wait for merge before starting the next piece,
  unless told otherwise.
- Every PR explains what was built, the judgement calls and why, and how it
  was verified.
- Match the risk approach to the blast radius: a function with many callers
  gets a compatible wrapper when it moves; one with a single caller can
  take a cleaner signature directly.

## Verification discipline

- Verify assumptions empirically, especially about platform and tooling
  behaviour: a one-line probe beats a confident guess.
- Drive anything user-facing in a real browser. Check the effect of a change
  (a computed style, a DOM count, a real response), not just that it didn't
  throw.
- Re-verify after a clean rebuild for anything involving build output.
- Treat claims in Claude-written docs as unverified until a person confirms
  them.

## When something's missing

When a needed tool, library or capability is missing, say so and discuss
options before improvising a workaround. A workaround presented as done
costs more trust than the time it saved.
