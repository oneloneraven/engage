# Incident response

What to do when something's wrong in production, in order. After it's over,
write a review from the [post-incident review template](post-incident-review.md).

## Severity

| Severity | Examples | Respond |
|---|---|---|
| **P1: people can't use it** | Site down; error rate above 5% for 5 minutes; sign-in failing for everyone | Within the hour |
| **P2: degraded or at risk** | A new error after a deploy; slow responses for 30 minutes; a quota at 80% | Same day |
| **P3: worth knowing** | Slow queries; a one-off error | Weekly |

## The first 10 minutes

1. **Is it real?** Check the health endpoint and the uptime monitor.
2. **Is it us or the platform?** Check the platform's status page.
3. **Did a deploy just happen?** Compare the live version with the latest
   deploy run. If the problem started with a deploy, roll back before
   investigating.
4. **Look at the errors** in the platform's logs, grouped by route and
   version.
5. **Roll back or fix forward.** Roll back if a recent deploy caused it and
   rolling back is safe (no migration since the previous tag, or one that's
   backward compatible). Otherwise fix forward through a normal PR.
6. **Say what's happening** on the status page if it's P1 or lasts more
   than a few minutes.

## Status page updates

- **Investigating:** "We're looking into a problem with Engage."
- **Identified:** "We've found the cause and are fixing it."
- **Monitoring:** "A fix is live. We're watching to make sure it holds."
- **Resolved:** "Everything's working again."

## Levers

| Lever | What it does | How |
|---|---|---|
| Roll back | Redeploys an earlier tag | Run the deploy (or promote) workflow with the earlier tag |
| Rotate a secret | Replaces a leaked credential | Revoke it at the source, then set the new value everywhere it's used |
