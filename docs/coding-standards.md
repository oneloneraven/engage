# Coding standards

The standard this project's code, and every code review, is held to. Part 1
is how to review. Part 2 is the decisions already made here, so they aren't
silently reversed.

## Part 1: Review framework

### Personas

Adopt all of them at once; each surfaces issues in its own domain.

- **Platform specialist**: whether the code is idiomatic for the platform
  it runs on, its runtime limits, and its failure modes. Each stack section
  in Part 2 says what this persona checks.
- **Architecture generalist**: structure, data flow, the client-server
  boundary, API design (semantics, status codes, error shapes,
  idempotency), coupling between modules, and whether it will scale as
  features are added.
- **Software engineering principles**: single responsibility, unnecessary
  abstraction or premature generalisation, duplication that should be
  extracted (or extraction that's over-engineered for one caller),
  speculative code for requirements that don't exist, and cleverness where
  a simpler solution was available. SOLID, KISS, DRY, YAGNI,
  Tell-Don't-Ask, high cohesion and low coupling.
- **Quality and operations**: test coverage of what's actually risky,
  error handling (network failures, malformed input, races), validation at
  trust boundaries, secrets and whether anything sensitive could leak into
  a bundle or git history, deploy and rollback safety, and observability.
- **UI and UX**, where there's a UI: accessibility, responsive behaviour,
  loading, empty and error states, feedback for async actions, and visual
  consistency.

### Process

- Read the actual code. Don't infer from file names or assume best practice
  was followed.
- For each finding, cite the file and line, explain why it's a problem, and
  state the concrete risk if it's left.
- Severity:
  - **Blocking**: will break in production, or is insecure.
  - **Should-fix**: a real problem, not urgent.
  - **Worth considering**: opinion, lower confidence.
- Don't pad. If a persona has nothing significant, say so briefly.
- Where a fix isn't obvious, propose one concretely.
- Verify platform behaviour empirically where practical rather than trusting
  documentation alone.

### Output

Group findings by severity, then by persona. End with the top five things
to fix first and a short paragraph on what's done well.

## Part 2: Project standards

### Engineering

- Hold work to real rigour: the principles above applied while building,
  not just while reviewing. When the honest scope is bigger than the
  cheapest version, say so and let the owner choose.
- Validate all input at trust boundaries on the server. Client-side
  validation is never a trust boundary.
- Never trust an identity or owner id supplied in a request body; derive it
  from the authenticated session.
- Let errors reach the boundary. Don't catch an error just to tidy it up;
  the boundary logs it once and returns a reference the user can quote.
- Use timing-safe comparison for any secret, token or signature, and rate
  limit the endpoint that checks it.

### Logging

- Use a structured logger, not raw console output: one JSON object per
  event with request id, route, environment and release version.
- Name events as stable dotted names (`email.failed`); put details in
  fields.
- Levels: `error` needs looking at, `warn` a handled failure, `info` a
  notable step that worked, `debug` for investigation only.
- The logger passes only allowlisted fields and redacts the rest. Never log
  a body, an email address, a password, token or cookie, or user content.
- Identify a person by internal id only.

### Testing

- Test at the right layer: unit tests for logic, integration tests against
  the real runtime, end-to-end tests against the real application. Mock only
  states the real backend can't produce.
- A failing test is a bad test or a real bug. Never dismiss one as flaky.
- For anything user-facing, verify in a real browser, not just by reading
  the code.

### Accessibility

Where there's a UI, every page meets WCAG 2.2 AA, checked automatically and
by hand at phone and desktop widths in light and dark themes.

### Comments and docs

- Code documents itself. The default is no comment.
- A comment is one line, for a "why" the code can't express: a platform
  workaround, a subtle invariant, a surprising behaviour. Never what the code
  does, and never how it got here.
- Anything longer goes in `docs/` or an ADR; history goes in commits and PRs.
- No sidecar notes files.
- A comment that no longer matches the code is a bug: fix or delete it in
  the same change. Cut any narrative comment you touch.
- Nothing users download contains comments.
- Docs describe the current state and link to ADRs for the reasons. Update
  them in the same PR as the change that makes them wrong.

### Security

- Keep [the threat model](threat-model.md) current. A change that adds or
  moves a trust boundary updates it in the same PR: a new host, an auth or
  session change, data exposed beyond its owner, a new processor, a new
  secret or CI permission.
- Secrets never enter git. Local secrets files are gitignored and treated
  as real.
- CI workflows declare least-privilege permissions and pin actions by commit
  SHA.
- Every job's `runs-on` is an exact image (`ubuntu-26.04`, `macos-26`), never
  a `-latest` label. Dependabot doesn't move it: when GitHub moves a
  `-latest` label to a new image, move every pin to that image by hand in
  one PR.

### JavaScript toolchain

Platform persona for this stack: runtime differences between Node and
wherever the code runs, module boundaries, async error handling, and the
supply-chain exposure of every dependency.

- **pnpm only.** `pnpm install`, `pnpm exec`, lockfile committed.
  `pnpm-workspace.yaml` holds new releases for three days
  (`minimumReleaseAge`) and denies install scripts unless a package is
  listed in `allowBuilds` with a reason. Don't approve a build script
  without knowing why it's needed. Transitive security fixes go in
  `overrides`, scoped to the major line they fix.
- **Node is the exact release in `.nvmrc`.** Every `setup-node` step reads
  it (`node-version-file`) and `nvm use` picks it up locally. Dependabot
  doesn't update it, so move it by hand: to each new patch release on the
  current line once it's three days old (sooner for a security release), and
  to the newest Active LTS line when that changes. Any `@types/node` stays
  on the same major.
- **Lint and format with Biome.** Warnings fail CI. A deliberate exception
  gets a `biome-ignore` comment saying why.
- **Type-check with `tsc`** over JavaScript with JSDoc types and
  `strictNullChecks`. Types live in JSDoc, not TypeScript files.
- **Unit tests with Vitest**, against real code; mock only what the
  runtime can't produce.
- **Validate URL schemes server-side** for user-submitted URLs: `http:` and
  `https:` only.
- **Client-generated UUIDs** for entity ids, so a duplicate write is an
  idempotent replay rather than a collision.

### Web app

Platform persona for this stack: what ends up in the bundle and its size,
browser support, loading, empty and error states, and accessibility.

- **End-to-end tests with WebdriverIO** in Chromium and Firefox, against the
  built app, and in Safari on a macOS runner for public repositories
  (`E2E_BROWSERS` picks the browsers). axe-core checks every page against WCAG 2.2 AA at phone width
  in light and dark themes; a new page joins the accessibility spec's list.
- **Browser runs wait for lint and typecheck.** The `e2e` and `e2e-safari`
  checks fail with a reason if a quick check failed, rather than passing as
  skipped. Superseded pull request runs are cancelled.
- **Safari runs only specs tagged `@safari`.** Safari on GitHub's macOS
  runners opens no WebDriver BiDi session, so a spec that uses BiDi
  (`browser.mock`, `emulate`, `setViewport`, `parallelMode`, per-user-context
  cookies) fails there. Put `@safari` in a `describe` title only when every
  command it and the shared hooks use is WebDriver Classic. Other browsers
  run every spec. Keep the shared hooks Classic-only, or untagged specs and
  tagged ones will diverge.
- **Escape all user-controlled data** before it's interpolated into HTML.
  Never build markup from raw input.
- **A real `<button>` for anything clickable.** Modals have
  `role="dialog"`, `aria-modal`, a focus trap and Escape to close.
- **Links in running text are underlined**, not told apart by colour alone.
- **A button that opens something uses `aria-expanded`; one that toggles a
  setting uses `aria-pressed`.** Never both on the same button.
- **Don't style an empty state as an error.**

### Cloudflare and OpenTofu

Platform persona for this stack: routing correctness (including static
assets taking precedence over the Worker), Workers runtime limits (no Node
APIs unless `nodejs_compat` is on, CPU time, cold starts), caching headers
and edge cache behaviour, binding and secret handling per environment, and
whether the design is idiomatic for the platform rather than fighting it.

- **Everything provisionable is in OpenTofu** (`infra/`, HCL): declarative,
  repeatable, idempotent. Only data, runtime secrets, the state bucket and
  CI credentials live outside it.
- **State is in R2, never in git.** A `sensitive` value is still written to
  state in plain text.
- **Data-bearing resources have `prevent_destroy`.** The infra workflow
  refuses any plan that deletes.
- **Tools and runners are pinned exactly.** `tofu_version` in `infra.yml`
  is an exact release more than 72 hours old, upgraded by hand because
  Dependabot doesn't track it; every workflow runs on `ubuntu-26.04`, moved
  by hand when GitHub moves `ubuntu-latest`.
- **Least-privilege tokens**, one per job (preview, deploy, infra plan,
  infra apply), each scoped to the narrowest account or zone that offers the
  permission.
- **Every wrangler environment repeats every binding.** An environment that
  leaves one out doesn't inherit it, or worse, a misconfigured one inherits
  production's.
- **API responses for changing data send `Cache-Control: no-store`.**
- **Verify platform behaviour empirically** (a real request, `wrangler dev`,
  `--dry-run`) rather than trusting documentation alone.
- **Merging `infra/` is a production change.** It never takes
  `release: none`.
