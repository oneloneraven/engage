# 7. Show inbound HTML only in a sandbox

## Status

Accepted

## Context

Inbound email often carries HTML that differs from its text part, so the
owner sometimes needs to see it. Email HTML is hostile by default: it can
carry script, remote images that report when and where it was opened, and
markup aimed at the page it's shown in. Sanitising it at rest would change
what was received and depend on a sanitiser keeping up with every trick.

## Decision

Inbound HTML is stored exactly as received and shown only when the owner
asks for the formatted view. It is served as its own document, from
`/api/items/:id/messages/:messageId/html`, under a `sandbox` Content
Security Policy that allows inline styles and `data:` images and fonts and
nothing else, and is loaded into an `<iframe sandbox>` with no tokens. It
runs no script, has an opaque origin and loads nothing from elsewhere, even
if opened directly. It is never passed to the admin shell's scripts, which
render all user text as text only.

`srcdoc` was rejected: a `srcdoc` document inherits the shell's policy, which
would either block the inline styles email relies on or force the shell to
allow them.

## Consequences

- The shell's own policy stays strict.
- Nothing in an email can track when it was read.
- A link in the formatted view can still navigate the frame to another
  admin path; the threat model records that as an accepted gap.
