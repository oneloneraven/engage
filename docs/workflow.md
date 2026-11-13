# Workflow

## Issues and the board

- Every change needs a GitHub issue before work starts.
- The project board's Status moves with the work:
  - **Ready**: the issue has enough information to pick up;
  - **In progress**: a branch exists (set automatically when the branch
    name contains the issue number);
  - **In review**: a PR is open (set automatically);
  - **Done**: set by the board's built-in workflows on merge or close.
- Scope issues from the real code, not from memory. Write acceptance criteria
  that can be checked against the repo. State what's out of scope and why.
- When later work shows an earlier issue was wrong or too narrow, update that
  issue rather than letting it go stale.

### The board

The board has four views:

- **Board**: columns by Status, sorted by Priority;
- **Epics**: open epics, sorted by Status;
- **No parent epic**: open issues that have no parent epic and aren't epics
  themselves, so it shows what still needs filing under one;
- **Bugs & Chores**: open issues titled `[BUG]` or `[CHORE]`.

Each item has three fields besides Status:

- **Priority**: P0, P1 or P2;
- **Size**: XS, S, M, L or XL;
- **Estimate**: a number.

Epics are parent issues titled `[EPIC] …`, with the work under them as
sub-issues. Title a bug `[BUG] …` and a chore `[CHORE] …` so the Bugs &
Chores view finds them.

## Branches

Name a branch by what the change does for users, with the issue number:
`<prefix>/<issue>-<short-description>`.

| Prefix | For |
|---|---|
| `feature/` | New behaviour or content, including user-facing copy and help |
| `fix/` | Corrections to existing behaviour or content |
| `ci/` | Workflows and automation |
| `chore/` | Tooling, dependencies and repository configuration that never reach users; workflows and automation are `ci/` |
| `spike/` | Investigations; not merged as-is |
| `docs/` | Repo docs that never reach users |

## Pull requests

- One focused PR per coherent piece of work. Group only small, related changes.
- Open as a draft with the release label set at creation
  (`gh pr create --draft --label "release: patch"`), then mark it ready. The
  label check skips drafts, so it first runs with the label in place.
- The PR body says what changed, the judgement calls made and why, and how
  it was verified. It is not a restatement of the diff.
- Merges are squash only. The branch is deleted on merge.
- Claude merges a PR once it meets the definition of done and every required
  check passes, including PRs that cut a release. This is standing approval:
  it asks first only when it needs the maintainer's input.

## Git

- Never commit to `main`. Check `git branch --show-current` before the
  first commit. If a commit lands on `main` by mistake, branch from it,
  reset `main` to `origin/main`, and push the branch.
- Never force-push without asking first, every time.
- Update a pushed branch by merging `main` into it, not by rebasing.
- Before resuming work on a branch, `git fetch` and check its PR. If the PR
  has merged, start fresh from `main`
  (`git fetch origin main && git checkout -B <branch> origin/main`); carry
  over any real unmerged commits.
- When resolving conflicts, list every conflicted file
  (`git diff --name-only --diff-filter=U`), check none still has conflict
  markers, and stage files by name, never `git add -A`.
- Commits are signed.

## GitHub API

GitHub's secondary rate limit caps content-generating requests at 80 per
minute and 500 per hour.

- Pace mutations (creating issues, PRs, comments, merges) at least a second
  apart and never in parallel.
- Skip existence checks a create can answer by failing safely.
- On a rate-limit error, stop and report. Never retry into it.
- Projects v2 needs the `project` OAuth scope: `gh auth refresh -s project`.

## Ways of working

- Propose before building when there's an open design question. A concrete
  fix with a clear direction goes straight ahead.
- Change only what was asked. Flag wider improvements and wait for an answer.
- Verify before claiming something works. For anything user-facing, drive it
  in a browser. For platform behaviour, check it empirically rather than
  trusting docs.
- Report failures, skipped steps and anything unverified plainly.

## Dependencies

- Start each piece of work with `pnpm outdated` (or the stack's equivalent)
  and the open Dependabot alerts. Bring anything behind up to date in its own
  PR.
- Default to the latest stable version. A breaking bump gets its own issue
  first, never applied blindly or skipped silently.
- Judge a pre-release version by whether the vendor ships it as their
  current release, not by its suffix.
- New dependencies and vendors are screened first
  ([ADR-0002](adr/0002-screen-dependencies-against-bds-boycott-lists.md)).
