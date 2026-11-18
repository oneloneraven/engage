# 5. Content-free notifications

## Status

Accepted

## Context

The owner wants to know when something new arrives without opening Engage.
Chat notifications are convenient but sit outside Engage's controls: they
are stored by a third party, shown on lock screens and kept indefinitely.
Feedback text, email content and contact details must never end up there.

## Decision

New items and replies send a Discord message that carries only the kind of
item, the product's name and a link to the item in Engage. Nothing submitted
by a person is included: no message text, subject, name or email. Mentions
are disabled (`allowed_mentions: { parse: [] }`). Each product has its own
webhook, held as a Worker secret. A failed notification is logged and never
blocks storing the item. Mail in junk and app submissions over the daily cap
don't notify at all.

## Consequences

- Discord never receives personal data, so it isn't a processor of it.
- Reading anything means opening Engage, behind Access.
- The link reveals that an item exists and its id, which is meaningless
  without access to the admin host.

## Screening record

| Dependency | Maintainer | On a list | Note |
|---|---|---|---|
| Discord (webhooks) | Discord Inc. | N | Checked 14 November 2026. Receives no personal data. |
