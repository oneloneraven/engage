# Definition of done

A PR is ready for review when every item holds. The PR template carries the
same list.

1. **Tracked.** An issue exists, the branch is linked to it and named with
   the right prefix, and the issue is on the board ([workflow](workflow.md)).
2. **Reviewed.** The diff has had a `/code-review` run against the
   [coding standards](coding-standards.md), and every blocking and
   should-fix finding is fixed. A finding is skipped only if it's wrong or
   out of scope, never because it's small.
3. **Tested.** New or changed behaviour is covered at the right layer and
   the test suite passes.
4. **Verified.** User-facing changes have been driven in a browser, in light
   and dark themes, at desktop and phone widths.
5. **Screened.** Any new dependency or vendor has been checked and recorded
   ([ADR-0002](adr/0002-screen-dependencies-against-bds-boycott-lists.md)).
6. **Documented.** Docs and ADRs are updated where behaviour or a decision
   changed, and the diff adds no narrative comments.
7. **Clean.** Nothing the change replaced is left behind: no unused exports,
   styles, fixtures, scripts or tests.
8. **Labelled.** The PR has the right release label ([versioning](versioning.md)).
