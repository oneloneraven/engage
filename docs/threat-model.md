# Threat model

What Engage protects, from whom, and how. Update it in the same PR as any
change that adds or moves a trust boundary ([coding standards](coding-standards.md#security)).

## The system

One Cloudflare Worker serves two hosts ([ADR-0003](adr/0003-one-worker-two-hosts.md)):

- **Admin host** (`engage.`): the admin UI and API, behind Cloudflare Access.
  Only the owner uses it.
- **Public host** (`engage-api.`): submissions from product sites and apps,
  the testimonials feed, account deletion from products, and GitHub webhooks.
  Every route authenticates on its own.

Behind them:

- **D1** holds items, messages, testimonials, the sender blocklist and the
  audit log. **R2** holds email attachments.
- **Inbound mail** to each product's `hello@` (and aliases) and signed
  `reply+` addresses reaches the Worker's email handler through Email
  Routing. Replies go out through Email Sending.
- **GitHub**: Engage's GitHub App creates the issues the owner drafts and
  edits, receives issue close and reopen events, and triggers product site
  rebuilds when testimonials change.
- **Discord**: a content-free ping per new item ([ADR-0005](adr/0005-content-free-notifications.md)).
- A daily cron deletes items past their retention period.

## Trust boundaries

| Boundary | Between | What crosses it | Controls |
|---|---|---|---|
| Browser → admin host | You, signed in through Cloudflare Access, and the Worker | The admin shell, the admin API, and every item's content | Access at the edge, letting in only the owner's email, signed in with the Cloudflare account (passkey 2FA) as the only allowed login method, for 8-hour sessions with binding, HttpOnly and SameSite cookies; the Worker verifies the Access token on every admin path, assets included (`run_worker_first`), and refuses any email but the owner's (`OWNER_EMAIL`), failing closed when it isn't set, and serves the shell on the admin host only; the shell's policy runs only Engage's own scripts and frames only its own documents |
| Inbound email HTML → your browser | A sender's markup and the admin shell | Email HTML, shown only when you ask for the formatted view | Served as its own document under a `sandbox` policy (opaque origin, no script) that loads nothing from elsewhere, inside an `<iframe sandbox>`; never passed to the shell's scripts. User text is rendered as text only |
| Product site or app → public host | Anyone on the internet and the submissions API | Feedback and issue reports, with optional contact details | Web: Turnstile verified on the server, a honeypot field and a per-IP rate limit. App: a tighter per-IP rate limit and a per-product daily cap, above which submissions are kept but marked as suspected spam with no ping. Server-side validation of every field; unknown products rejected; errors never echo what was submitted |
| Product → account deletion | A product's own backend and `DELETE /v1/accounts/…` | An opaque account reference | A per-product secret, compared in constant time |
| Inbound mail → email handler | Any sender and the Worker | Email to `hello@`, its aliases and `reply+` addresses, with attachments | Mail to any other address is rejected; `reply+` addresses carry an HMAC of the item id ([ADR-0006](adr/0006-signed-reply-addresses.md)); SPF, DKIM and DMARC results are recorded and failing mail goes to junk with no ping; blocked senders go straight to junk |
| GitHub → webhook | GitHub and `POST /v1/github/webhook` | Issue close and reopen events | `X-Hub-Signature-256` verified in constant time against the webhook secret |
| Engage → GitHub | The Worker and the GitHub API | Issue drafts the owner has edited, and site rebuild triggers | A GitHub App with least privilege; drafts never pre-fill contact details or anything identifying, and message text is fenced so it can't render as markup |
| Engage → Discord | The Worker and a product's webhook | The kind of item, the product's name and a link | No submitted content or identity, and mentions disabled |
| Release job → GitHub API | `release.yml` and the release GitHub App | Short-lived App token (Contents and Workflows: read and write) to push release tags and create releases | Token minted only in the release job and scoped to this repository; App installed on this repository only; private key held as a repository secret |

## Assets

| Asset | Why it matters |
|---|---|
| Item content (feedback, email, contact details) | Personal data; leaking it breaks the privacy promise to every person who wrote in |
| Testimonials | Published on product sites; altering one or publishing without consent breaks the promise to the person quoted |
| Reply-address secret | Anyone holding it can post replies onto any item |
| GitHub App key and webhook secret | Anyone holding them can create issues in product repositories, or forge issue events |
| Per-product account secrets and Discord webhooks | Anyone holding them can clear account references, or post into the owner's notification channels |
| Release App private key | Anyone holding it can mint tokens that push tags and, through Workflows, change workflow files |

## Actors

| Actor | Capability | Motivation |
|---|---|---|
| Anonymous internet user | Any public request | Abuse, data access |
| A product's backend | Its own account secret | Clearing references it shouldn't |
| Sender of email | Any address, any content | Spam, phishing, tracking, script injection |
| Compromised dependency | Code execution at install or runtime | Credential theft |
| Maintainer account takeover | Repository and platform access | Anything |

## Threats (STRIDE)

| Threat | Category | Mitigation | Status |
|---|---|---|---|
| A forged reply address posts mail onto someone else's item | Spoofing | Reply addresses carry a truncated HMAC of the item id; anything that doesn't verify is rejected | Mitigated |
| A forged webhook clears or sets a "reply owed" flag | Spoofing | Every delivery's signature is verified against the webhook secret | Mitigated |
| A forged sender address gets mail treated as genuine | Spoofing | SPF, DKIM and DMARC results are recorded and shown; failing mail goes to junk | Mitigated |
| A testimonial misquotes the person | Tampering | The server accepts an excerpt only if it is a faithful subsequence of the original; attribution follows the person's credit choice; published only with recorded consent, and withdrawable | Mitigated |
| A state change can't be traced to who made it | Repudiation | Every state-changing action is appended to the audit log with the actor and target; the UI can't edit or delete it, and deletions keep only the item id | Mitigated |
| Script in an inbound email's HTML runs with your admin session | Elevation of privilege | HTML is only ever a sandboxed document with an opaque origin and no script, under a policy header that also applies if it's opened directly; the shell renders user text with text nodes only | Mitigated |
| Remote images or styles in an email's HTML tell the sender when and where you read it | Information disclosure | The formatted view's policy allows only inline styles and `data:` images and fonts; the shell's `frame-src 'self'` stops a link in it loading another site into the frame | Mitigated |
| The admin shell is served without the Access check, or on the public host | Information disclosure | The Worker runs before assets on every environment, so assets go through the same Access check and host routing as the API | Mitigated |
| Submitted content or identity leaks into Discord, logs or a public issue | Information disclosure | Discord pings carry no content; logs pass an allowlist of fields only; issue drafts are edited by the owner and never pre-filled with contact details | Mitigated |
| A flood of submissions or mail buries real items or runs up costs | Denial of service | Turnstile, per-IP rate limits and per-product daily caps for submissions; junk and blocklist for mail; retention clears junk after 30 days, in batches that stay inside the database's per-run query limit however large the backlog | Mitigated |
| A message too big for a database row fails to store and is lost | Denial of service | A body over its share of the row limit is kept whole in R2 as an attachment, and only its start is stored in the row | Mitigated |
| Leaked release token or App key used to alter workflow files | Elevation of privilege | The Workflows permission is needed because GitHub refuses a tag whose commit's workflow files differ from the default branch's. Tokens last one hour and are minted only in the release job; the key is a repository secret; the App is installed on this repository only | Accepted |

## Known gaps

- A link in an email's formatted view can navigate its frame to another admin path (the shell's `frame-src 'self'` can't name one path without naming the host), which loads there with your Access session. The frame stays sandboxed with an opaque origin, so the shell and its data are out of reach; the worst case is an item marked read. Accepted.
- Cloudflare's Access and Turnstile token permissions cover the whole account, so the infra apply token of any project in the account can edit any project's Access application, policy or widget. Mitigated in part by the Worker's own check of who is signed in; closed when admin Access moves to a central identity stack with its own token. Accepted until then.
