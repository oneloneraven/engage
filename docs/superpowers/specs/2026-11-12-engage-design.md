# Engage: design

Date: 2026-11-12
Status: Draft for approval

Engage is One Lone Raven's private control centre. It gives one place to take in and answer feedback and email for every product, approve releases, see whether everything is healthy, and check that every repository still meets the organisation's standards.

Decisions are marked **(Raven)** where the product owner made them, and **(design call)** where the designer made them and they're open to challenge. Anything unmarked is description.

## 1. Why

- **Two products, two incompatible feedback systems.**
  - Climbing Logbook (CL) has a capable but app-specific feedback system: D1 tables, an admin host behind Cloudflare Access, and Discord pings.
  - The Deaftly website turns each submission into an issue in a private GitHub repository. It collects no contact details, so nobody can be replied to.
  - The Deaftly app has no in-app feedback yet.
  - More products are coming, and each one shouldn't reinvent this.
- **Launch is 2–4 weeks away** for both products. Feedback has to work, in one place, before then.
- **Releases** are protected only by GitHub. Anyone who controls the GitHub account, or a leaked deploy token, can ship to production. Engage adds a second, independent factor.
- **Operational awareness** is scattered across Better Stack, Grafana, Cloudflare and GitHub. Raven wants one morning view that says "all good" or "here's what needs you", without rebuilding those tools.

## 2. Goals, non-goals, anti-goals

### Goals

1. A single inbox for feedback, issue reports and emails sent to product contact addresses, across all products. From it Raven can reply, triage, turn items into GitHub issues and pick out testimonials.
2. Content-free Discord notifications for anything new.
3. A release approval gate that needs both GitHub and Engage before anything reaches production.
4. A home page that answers "is everything green, and what needs me?" in seconds.
5. A light health and engagement view per product, with trends, that links out to the real tools.
6. A read-only conformance view of every repository against the bootstrap standards.
7. Adding a new product is configuration, not code.

### Non-goals

- Rebuilding dashboards that Grafana, Cloudflare or Better Stack already provide. Engage shows headline numbers and links to them.
- Replacing Discord alerting from monitors.
- Changing repositories. Engage observes them; bootstrap changes them.
- Multiple users or roles. Raven is the only user.
- A mobile app (later; see §12).
- iOS / App Store integrations, until an iOS app exists.

### Anti-goals: it fails if…

- Feedback text, email content or anyone's identity reaches Discord, a public GitHub issue, or any log, without Raven deliberately putting it there.
- A testimonial is published without the person's recorded consent, or is altered beyond trimming.
- Engage becomes the easiest way to compromise production, for example a credential that's broader than it needs to be, or an approval path that skips Access.
- A broken Engage can't be fixed because Engage gates its own releases.
- The admin host accepts unauthenticated traffic.

## 3. Context: what exists today

| Thing | Where | Notes |
|---|---|---|
| CL feedback | `ravendarque/climbing-logbook` → now `oneloneraven/climbing-logbook` | Tables `issue_reports` and `feedback_submissions` (migrations 0018, 0019, 0023, 0040): message, optional contact email, user id, source page, section, app version, read/archived timestamps. Turnstile plus a D1 rate limit. `server/lib/support-notify.js` sends Discord pings with no submitted text, just a link. |
| CL admin host | ADR-0034 | `admin.climbinglogbook.com` behind Cloudflare Access. The Worker re-checks `Cf-Access-Jwt-Assertion` (signature, audience, issuer, expiry) and fails closed (`server/lib/access.js`). |
| Deaftly feedback | `oneloneraven/deaftly-website`, ADR-0004, `src/feedback.js` | Static Eleventy site served by a Worker. A no-JavaScript form; each submission becomes an issue in private `oneloneraven/deaftly-feedback`. Honeypot plus Workers rate limit, no email collected, retention deleted by hand monthly. |
| Analytics | CL #836 epic, #1521 | Grafana Cloud chosen for dashboards and alerting. Sources: Cloudflare GraphQL Analytics API, Workers Analytics Engine, Better Stack for uptime and status page. Web Analytics excludes EU visitors (CL ADR-0015). |
| Bootstrap | `ravendarque/claude-project-bootstrap` | Sets up repositories: rulesets, labels, board, CI, tag-based releases, security docs. `cloudflare-opentofu` deploys run under `environment: production` (and `beta`); Android releases under `environment: release`. Org board-sync GitHub App (ADR-0007); a separate release App per repository. |
| Email | CL `infra/email.tf` | Apex MX on Proton Pass (`hello@`); transactional mail through Resend. |
| Account | — | Cloudflare account currently on Workers Free; moving to Workers Paid **(Raven)**. All `oneloneraven` repositories are public; GitHub org is on Free. |

## 4. Architecture

### 4.1 Shape (design call, unless marked)

- **Repository:** new public repository `oneloneraven/engage`, set up with bootstrap modules `core`, `js-toolchain`, `web-app` and `cloudflare-opentofu`. This design document is its first commit, at `docs/superpowers/specs/2026-11-12-engage-design.md`.
- **Runtime:** one Cloudflare Worker with:
  - D1 for data
  - R2 for email attachments
  - Cron Triggers for snapshots, retention and conformance
  - an `email()` handler for inbound mail
  - the Email Sending binding for outbound mail
  - Infrastructure in OpenTofu under `infra/`.
- **Hosts:**
  - `engage.oneloneraven.com` **(Raven)**: the admin UI and its API. Gated entirely by Cloudflare Access, with a policy for Raven only, MFA required, and short sessions. **(Raven: MFA, not a hardware key.)** Email one-time PIN alone isn't enough. The builder picks a login method that enforces MFA, such as an identity provider with 2FA enforced, or Access's own MFA if the account supports it. The Worker also verifies the Access JWT on every request and refuses everything if the Access settings are missing, the same pattern as CL's `server/lib/access.js`. Fails closed.
  - `engage-api.oneloneraven.com`: the public intake API, for submissions, the testimonials feed, GitHub webhooks and OIDC token exchange. It has no Access, and every route does its own authentication (see the per-route rules below).
  - The Worker routes strictly by host. Admin routes 404 on the public host, and the reverse.
- **Plan:** Workers Paid **(Raven)**. It unlocks Email Sending and higher limits, and removes the worry about sharing CL's daily request cap.
- **Discord:** one webhook per channel, configured per product. Every message is content-free: the kind, the product, and a link to Engage. `allowed_mentions: { parse: [] }`.
- **Audit log:** every state-changing action is appended to an `audit_events` table: who (the Access identity), what, target, and when. Nobody can edit or delete it from the UI.

### 4.2 Product registry

Products are rows, not code. Each product has:
- slug and display name
- domains
- the GitHub repository (or repositories) where issues go
- Discord webhook reference
- contact email domain
- engagement source and its configuration
- health sources (Better Stack monitor ids, Grafana alert or panel URLs)
- environments, for the beta-vs-prod comparison
- the testimonial feed on or off.

Secrets such as API tokens live in Worker secrets, never in rows. Adding a product means adding a registry row plus whatever bindings and DNS it needs in `infra/`.

### 4.3 GitHub App

A new org-level GitHub App, `oneloneraven-engage`, separate from the board-sync and release Apps. It has least privilege, following the reasoning in bootstrap ADR-0007. Permissions:
- Issues: read and write (create issues, receive close events)
- Deployments: read and write (approve and reject protection rules)
- Actions: read (run details for the approval page)
- Administration: read, and Contents: read (conformance)
- Metadata: read.

Webhooks it subscribes to:
- `issues` (closed and reopened)
- `deployment_protection_rule`.

The webhook secret is verified on every delivery.

## 5. Feedback and email (Module 1)

### 5.1 Intake

- **Two forms on every product (Raven):**
  - "Report an issue"
  - "Tell us what you think".
- **Where they appear (Raven):** in each app and on each product's marketing site.
- **One API:** `POST https://engage-api.oneloneraven.com/v1/submissions`.
  - Fields:
    - product
    - kind (`issue` | `feedback`)
    - message, up to 5,000 characters
    - optional contact email
    - source (`web` | `app`)
    - optional source page or app section
    - optional app version
    - for feedback only: optional quote consent plus a credit preference (`name` | `initials` | `anonymous`), and an optional name.
    - optional `context`: a product-specific object, validated against a schema stored in that product's registry entry **(design call)**. CL needs this for the reported username or entry and the error reference its "Report an issue" form already sends. Context fields are shown in the item view and are never copied into GitHub issues.
    - optional `accountRef`: an opaque account id from the product **(design call)**. When an account is deleted, the product calls `DELETE /v1/accounts/<product>/<accountRef>` (authenticated with a per-product secret), and Engage clears the reference. This replaces CL's `ON DELETE SET NULL`.
  - Unknown products are rejected. The server validates everything.
- **No-JavaScript websites:** websites can also POST the form directly (`application/x-www-form-urlencoded`) and get a 303 to the product's thanks page. This keeps deaftly.com working without JavaScript.
- **Contact details (Raven, D3):** an optional contact email on both forms. Without one, the form says plainly that it can't be answered.
- **Spam protection:**
  - **Web (Raven, D3):** Turnstile, verified server-side, plus a per-IP rate limit.
  - **App (Raven, D9):** no attestation. A tighter per-IP rate limit plus a per-product daily cap. Above the cap, submissions are accepted quietly but marked as suspected spam, with no Discord ping. Play Integrity / App Attest is revisited only if spam actually appears.
  - **Honeypot field on web forms (design call):** cheap, and catches basic bots before Turnstile runs.
- **On receipt:**
  - store the item in D1;
  - send a content-free Discord ping;
  - answer with the thanks page or JSON.
  - Errors never echo back what was submitted.

### 5.2 Inbound email (Raven, D4 and D5)

- **Apex MX moves to Cloudflare Email Routing on each product domain (Raven, D5).** This replaces Proton Pass for those domains and reverses CL #1693. No other addresses on those domains are in use, and none is a login or recovery address (Raven).
- **Addresses:**
  - `hello@<domain>` (and any aliases kept for old mail, such as `support@` on CL) routes to Engage's `email()` handler as an **email** item.
  - `reply+<itemId>.<sig>@<domain>` routes replies back onto the item they belong to. `sig` is a truncated HMAC of the item id, so nobody can forge a reply onto another item.
  - Anything else is rejected.
- **Parsing:** `postal-mime`. Text and HTML bodies are stored, with the HTML sanitised and shown in a sandboxed frame. Attachments go to R2 (25 MiB inbound cap), under the same retention as the item.
- **Spam:**
  - Each message's SPF, DKIM and DMARC results are recorded.
  - Failing or suspicious mail goes to a **junk** view and doesn't trigger a ping.
  - "Block sender" adds the address or domain to a blocklist, and future mail from it goes straight to junk.
- **Backup copy (design call):** a toggle to forward a copy of every inbound email to a verified Proton mailbox until Engage is trusted. Sends to verified destinations are free.
- **Privacy:** each product's privacy page and record of processing change to name Cloudflare (Email Routing and Sending) in place of Proton for those addresses.

### 5.3 Inbox

- **One inbox across products.**
  - Filters: product, kind (issue / feedback / email), state, starred, and has a linked issue.
  - Search over message text.
- **Item view:**
  - the message;
  - metadata (product, source, page or section, app version, received at, authentication result for email);
  - contact email, if given;
  - the conversation thread;
  - linked GitHub issue and its state;
  - testimonial excerpts.
- **States and actions (Raven):**
  - **Read / unread:** opening an item marks it read, and it can be marked unread again. A new inbound reply marks it unread.
  - **Star:** a free toggle.
  - **Respond:** only possible when a contact email exists. Sent with the Email Sending binding from `hello@<product domain>`, with `Reply-To: reply+…`, plus `Message-ID`, `In-Reply-To` and `References` headers so it threads in their mail client. The sent message is stored on the thread. Plain-text composer.
  - **Archive:** "dealt with". Leaves the inbox, can still be searched, and can be unarchived.
  - **Delete:** a hard delete of the item, thread, attachments and any testimonial excerpts, after a confirm step. Used for erasure requests and junk. The audit log keeps that a deletion happened, and the item id, but none of the content.
  - **Create GitHub issue:** see §5.4.
  - **Testimonial:** see §5.5.
- **"Open"** means read and not archived. **"New"** means unread.

### 5.4 Feedback → GitHub issue

- **Public-repository safety (anti-goal):** issues are public, so creating one is always a deliberate, edited step.
- **Flow:**
  1. The "Create issue" button opens a draft:
     - the repository is preselected from the registry;
     - title from the first line;
     - body holds the message in a fence longer than any backtick run in it (the Deaftly pattern), plus the app version and page or section;
     - label `bug` or `enhancement` by kind.
  2. Raven edits and redacts it.
  3. The contact email, name and anything identifying are **never** pre-filled and never copied across.
  4. On create, Engage stores the issue number and URL on the item.
- **Closing the loop:**
  - When the App receives `issues.closed` for a linked issue, the item gets a **reply owed** flag and appears under "Needs you", if the item has a contact email.
  - Sending a reply, or dismissing the flag, clears it.
  - Reopening the issue clears the flag too.

### 5.5 Testimonials

- **Consent:** only items with recorded quote consent can produce testimonials. For other items the action is disabled, with a reason.
- **Curating:**
  - Raven selects an excerpt.
  - Edits are limited to trimming with an ellipsis, and the server checks the excerpt is still a faithful subsequence of the original.
  - Attribution follows the person's credit choice.
  - Raven approves. Approved quotes can be withdrawn at any time.
- **Publishing:**
  - `GET https://engage-api.oneloneraven.com/v1/testimonials/<product>` returns approved excerpts: text, attribution and date, with no identifiers. Not cached, because sites read it only at build time, straight after a rebuild is dispatched (Raven, D12).
  - Marketing sites read it **at build time** and render it in their own style, with no runtime widget.
  - Approving or withdrawing a quote triggers the product site's rebuild, the same `repository_dispatch` pattern Deaftly already uses for releases.
- **Deletion:** deleting the item withdraws its quotes and triggers a rebuild.

### 5.6 Retention

- **Default (design call, continuing the existing Deaftly privacy promise):**
  - archived items are deleted 12 months after archiving;
  - un-archived items 12 months after their last activity.
- **Junk** is deleted after 30 days.
- A daily cron job does the deleting, replacing the manual runbook. The retention period is set per product in the registry.

### 5.7 Migration and removal (before launch)

1. Import CL's `issue_reports` and `feedback_submissions` (including read/archived state) and the issues in `deaftly-feedback` into Engage, once, with a script.
2. Change the CL app and site, the Deaftly site and the Deaftly app to submit to the Engage API, keeping each product's own form UI.
3. Remove CL's submission endpoints, tables (in a destructive migration), admin feedback pages and Discord code. Remove Deaftly's `feedback.js` and its token, and archive `deaftly-feedback` after deleting its issues.
4. Supersede CL ADR-0034's feedback scope and Deaftly-website ADR-0004 with ADRs pointing at Engage.
5. Update both privacy pages and both records of processing.

## 6. Releases (Module 2)

- **What's gated (Raven, D11):**
  - `production` and `beta` are gated **separately**: each deploy is approved on its own.
  - `infra` (OpenTofu apply) is gated too **(design call)**. Its token can change DNS, Access and everything else, so leaving it ungated would undo the rest.
  - Android `release` is gated.
  - **PR previews are not gated** and keep their GitHub-held `CLOUDFLARE_PREVIEW_TOKEN`.
- **Accepted residual risk:** as far as is known, a Cloudflare token can't be limited to previews only. So someone with the GitHub account could still reach Cloudflare through the preview token. A later fix is to run previews in a separate Cloudflare account, so the preview token can't touch production.
- **Splitting the shared token:** bootstrap currently gives `beta` and `production` the same `CLOUDFLARE_DEPLOY_TOKEN`. The broker issues each its own token, scoped to its environment's resources where Cloudflare allows it.
- **Gate:**
  - Engage's GitHub App is registered as a **custom deployment protection rule** on each product repository's `production`, `beta` and `infra` environments (Workers) and `release` environment (Android). This is available because the repositories are public.
  - On `deployment_protection_rule`, Engage stores a pending release and sends a content-free Discord ping.
  - It then appears under "Needs you" and **Releases**.
- **Approval page:** repository, environment, version or tag, commit SHA, the PRs included since the last approved release, CI status, and a link to the run. Approve or reject, with an optional note. Engage calls GitHub's review endpoint, and the decision goes into the audit log.
- **Raven's context:** Raven merges every PR, so releases are never a surprise. A clear "waiting" indicator is enough for v1. Push to a phone comes later.
- **Credential broker (design call; this is the real second factor):**
  - Cloudflare deploy tokens are removed from GitHub secrets.
  - The deploy job asks GitHub for an OIDC token (audience `engage`) and POSTs it to `engage-api.oneloneraven.com/v1/deploy-credentials`.
  - Engage verifies:
    - the token's signature against GitHub's published keys;
    - its repository, workflow, ref, SHA, environment and `run_id`;
    - that an **approved** release with exactly those values exists and hasn't been used.
  - It then returns a short-lived Cloudflare API token scoped to that product's resources, expiring in under an hour.
  - Someone who controls GitHub alone can neither approve nor obtain a token. Removing the protection rule doesn't help them either, because without Engage's approval there's no credential.
  - **Sensitive:** Engage needs a parent Cloudflare credential allowed to create scoped tokens. It's stored as a Worker secret, used only by the broker, and every token it mints is logged.
- **Android (v1):**
  - The signing key stays an environment secret on `release`, protected by the rule only.
  - Brokering Play publishing credentials, a Google service account, is designed in but built later.
- **Engage's own releases:**
  - Engage does **not** gate itself, because a broken Engage would block the fix that repairs it.
  - Engage's `production` environment uses GitHub's built-in required reviewer (Raven). Self-review isn't blocked by default, and the run is started by the release App anyway.
  - A break-glass runbook covers deploying Engage by hand.
- **Bootstrap changes:**
  - The `cloudflare-opentofu` templates (`deploy.yml`, `deploy-beta.yml`, `promote.yml`, `infra.yml` apply) and the `android-toolchain` release template get the OIDC step, the `id-token: write` permission, and the protection rule on their environments.
  - `CLOUDFLARE_DEPLOY_TOKEN` and `CLOUDFLARE_INFRA_APPLY_TOKEN` are removed from new repositories. The infra plan token and the preview token stay in GitHub.
  - Existing repositories get a migration runbook.

## 7. Home page

**Layout (Raven): a "needs you" list on top, then one card per product.**

- **Verdict bar:** "All green", or "N things need you".
- **Needs you:**
  - red or amber health, with a direct link to the source (the Better Stack incident or the Grafana alert or panel);
  - releases waiting;
  - "reply owed" items;
  - conformance failures.
- **Message counts:** new, open and reply owed, each linking to a filtered inbox.
- **Product card:**
  - health dot;
  - new / open counts;
  - one engagement metric with a 30-day sparkline and % change;
  - a "beta ahead of prod" badge showing the version and its age. It goes amber after 7 days (design call, configurable).
- **Visual design:** the wireframes were layout only. A proper visual design comes at build time (Raven).

## 8. Health and engagement (Module 3, kept light)

- **Health sources, per product:**
  - Better Stack: monitor status and open incidents, through its API.
  - Grafana Cloud: alert rule state, through its API.
  - Engage shows a status dot and a one-line reason, and links out. Monitor alerts keep going to Discord as they do now (Raven: light touch).
- **Engagement sources: a plug-in per product, chosen in the registry.**
  - **Web visits:** the Cloudflare GraphQL Analytics API (Web Analytics / zone). Labelled as excluding EU visitors.
  - **Accounts:** a product's own read-only usage endpoint. CL already has the admin usage endpoint; Engage calls it with an Access service token.
  - **Android downloads now:** GitHub Releases asset download counts.
  - **Play Store, from launch:** Play Console daily statistics reports, exported to a Cloud Storage bucket and read daily with a service account. To be confirmed at build time.
  - **App Store:** later.
- **Snapshots:** a daily cron writes one row per product per metric to D1, which feeds the sparklines and the % change. Engage keeps these indefinitely. They're aggregates, with no personal data.
- **Beta vs prod:** the deployed version per environment, from a `/version` endpoint each product exposes, or from GitHub deployments. The "since" timestamp is when that beta version first appeared.

## 9. Conformance (Module 4)

- **What it checks:** a daily cron checks every `oneloneraven` repository against the rules bootstrap sets up:
  - rulesets and branch protection
  - required checks
  - labels
  - security policy and the core docs present
  - Dependabot
  - the board-sync App installed
  - Engage's protection rule on the deploy environments
  - no long-lived Cloudflare deploy secret.
- **Single source of truth:** the check definitions live in the bootstrap repository as a machine-readable file. Engage reads them, so bootstrap and Engage can't drift apart.
- **Output:** a grid of repositories against checks, showing pass or fail, the reason and a link. Failures appear under "Needs you".
- **Read-only.** Fixing things stays with bootstrap and Claude.

## 10. Security summary

- The admin host is behind Access with MFA, and the JWT is re-verified in the Worker so it fails closed.
- Production, beta, infra and Android releases need Engage's approval. Previews are the one accepted exception (§6).
- Public routes each authenticate their own way:
  - Turnstile and rate limits for submissions;
  - HMAC for webhooks and reply addresses;
  - OIDC plus a matching approval for credentials.
- The GitHub App has least privilege and its own key. The Cloudflare parent credential is used only by the broker.
- Discord, logs and GitHub issues never carry submitted content or identity.
- Everything state-changing goes into the audit log.
- Threat model, data-protection record and privacy page come from the bootstrap `core` module, filled in for this design.

## 11. Build order (design call; Raven chose to design everything now)

1. **Before launch (2–4 weeks):**
   - the platform: repository, hosts, Access, registry, audit log, GitHub App;
   - feedback and email: intake, inbound email, inbox, replies, issues, testimonials, retention;
   - migrating both products onto it;
   - the home page with message counts.
2. **Releases:** the protection rule, approval page, credential broker and bootstrap template changes.
3. **Health and engagement cards,** and beta vs prod.
4. **Conformance.**

## 12. Later (out of scope for v1)

- Phone notifications: an installable web app with Web Push is the expected route.
- Play publishing credentials through the broker.
- App Store engagement and App Attest.
- Play Integrity, if app spam appears.
- A separate Cloudflare account for PR previews, to close the preview-token gap.

## 13. Related work outside Engage

- **Move CL from Resend to Cloudflare Email Sending now (Raven, D7: after this design).** While there are two users and sign-ups are closed. Replace `server/lib/email.js`'s Resend client with the `send_email` binding, onboard the domain to Email Sending in `infra/`, and remove the Resend key and DNS records. Update the privacy page and record of processing.
- **Move the product domains' MX from Proton Pass to Email Routing** (§5.2), coordinated with Engage's inbound email going live.
- **Build the Deaftly app's two in-app forms.** The app has none today. Native Compose screens posting to the intake API with `source: app`, and the app version filled in automatically.
- **Prerequisite:** the Cloudflare account upgraded to Workers Paid before Engage's email features are built.

## 14. Left to the builder

- The UI framework and component approach within the `web-app` module, and the visual design.
- D1 schema details, indexes and pagination.
- The exact rate-limit numbers and daily caps.
- Sparkline rendering.
- How the excerpt-faithfulness check works.
- Retry and backoff for GitHub, Cloudflare, Better Stack and Grafana calls.
- Structuring the Worker (one Worker with modules, or Workers with service bindings), as long as the host separation in §4.1 holds.
