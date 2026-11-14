# 3. One Worker on two hosts

## Status

Accepted

## Context

Engage has two very different audiences. The owner uses an admin UI and API
that can read and change every item. Product sites and apps, GitHub and
inbound mail reach public endpoints that anyone on the internet can call.
Running these as separate Workers would duplicate the data layer, bindings
and deployment; running them on one host would put public routes and admin
routes behind the same perimeter.

## Decision

One Worker serves two hosts and routes strictly by hostname:

- `engage.oneloneraven.com`: the admin UI and its API, behind Cloudflare
  Access. Access lets in only the owner's email, signed in with one pinned
  login method backed by passkey 2FA. The Worker then verifies the Access
  token itself (RS256 only, keys by `kid`, signature, audience, issuer,
  expiry) and refuses any email but the owner's. It fails closed when any of
  that configuration is missing.
- `engage-api.oneloneraven.com`: the public API. It has no Access, and every
  route authenticates in its own way (Turnstile and rate limits for
  submissions, HMAC for webhooks and reply addresses, a per-product secret
  for account deletion).

Admin routes don't exist on the public host, and public routes don't exist
on the admin host. The Worker runs before its static assets
(`run_worker_first`), so the admin shell itself is behind the same checks.

## Consequences

- One codebase, one database and one deployment, with the trust boundary
  enforced in two independent places for the admin host.
- A routing mistake could expose an admin route publicly, so host routing
  is covered by tests and the shell is never served without the Worker.
- Access configuration lives in this project's infrastructure for now.
  Cloudflare's Access token permissions are account-wide, which the threat
  model records as a known gap until admin Access moves to a central stack
  (#40).
