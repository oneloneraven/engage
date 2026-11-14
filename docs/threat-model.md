# Threat model

What Engage protects, from whom, and how. Update it in the same PR as any
change that adds or moves a trust boundary ([coding standards](coding-standards.md#security)).

## The system

Describe the components, where each runs, and how data flows between them.

## Trust boundaries

| Boundary | Between | What crosses it | Controls |
|---|---|---|---|
| Browser → admin host | You, signed in through Cloudflare Access, and the Worker | The admin shell, the admin API, and every item's content | Access at the edge, letting in only the owner's email, signed in with the Cloudflare account (passkey 2FA) as the only allowed login method, for 8-hour sessions with binding, HttpOnly and SameSite cookies; the Worker verifies the Access token on every admin path, assets included (`run_worker_first`), and serves the shell on the admin host only; the shell's policy runs only Engage's own scripts and frames only its own documents |
| Inbound email HTML → your browser | A sender's markup and the admin shell | Email HTML, shown only when you ask for the formatted view | Served as its own document under a `sandbox` policy (opaque origin, no script) that loads nothing from elsewhere, inside an `<iframe sandbox>`; never passed to the shell's scripts. User text is rendered as text only |
| Release job → GitHub API | `release.yml` and the release GitHub App | Short-lived App token (Contents and Workflows: read and write) to push release tags and create releases | Token minted only in the release job and scoped to this repository; App installed on this repository only; private key held as a repository secret |

## Assets

| Asset | Why it matters |
|---|---|
| Item content (feedback, email, contact details) | Personal data; leaking it breaks the privacy promise to every person who wrote in |
| Release App private key | Anyone holding it can mint tokens that push tags and, through Workflows, change workflow files |

## Actors

| Actor | Capability | Motivation |
|---|---|---|
| Anonymous internet user | Any public request | Abuse, data access |
| Signed-in user | Their own account | Access to others' data |
| Compromised dependency | Code execution at install or runtime | Credential theft |
| Maintainer account takeover | Repository and platform access | Anything |

## Threats (STRIDE)

| Threat | Category | Mitigation | Status |
|---|---|---|---|
| | Spoofing | | |
| | Tampering | | |
| | Repudiation | | |
| Script in an inbound email's HTML runs with your admin session | Elevation of privilege | HTML is only ever a sandboxed document with an opaque origin and no script, under a policy header that also applies if it's opened directly; the shell renders user text with text nodes only | Mitigated |
| Remote images or styles in an email's HTML tell the sender when and where you read it | Information disclosure | The formatted view's policy allows only inline styles and `data:` images and fonts; the shell's `frame-src 'self'` stops a link in it loading another site into the frame | Mitigated |
| The admin shell is served without the Access check, or on the public host | Information disclosure | The Worker runs before assets on every environment, so assets go through the same Access check and host routing as the API | Mitigated |
| | Denial of service | | |
| Leaked release token or App key used to alter workflow files | Elevation of privilege | The Workflows permission is needed because GitHub refuses a tag whose commit's workflow files differ from the default branch's. Tokens last one hour and are minted only in the release job; the key is a repository secret; the App is installed on this repository only | Accepted |

## Known gaps

- A link in an email's formatted view can navigate its frame to another admin path (the shell's `frame-src 'self'` can't name one path without naming the host), which loads there with your Access session. The frame stays sandboxed with an opaque origin, so the shell and its data are out of reach; the worst case is an item marked read. Accepted.
- Cloudflare's Access and Turnstile token permissions cover the whole account, so the infra apply token of any project in the account can edit any project's Access application, policy or widget. Mitigated in part by the Worker's own check of who is signed in; closed when admin Access moves to a central identity stack with its own token. Accepted until then.
