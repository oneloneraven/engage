# 6. Signed reply addresses

## Status

Accepted

## Context

Replies sent from Engage need to come back onto the right item. Matching on
subject lines or `In-Reply-To` alone is unreliable, and a guessable address
would let anyone post into another person's conversation.

## Decision

Each reply is sent from the product's `hello@` address with
`Reply-To: reply+<itemId>.<sig>@<domain>`, where `sig` is the first 16 hex
characters of an HMAC-SHA256 of the item id under a Worker secret
(`REPLY_ADDRESS_SECRET`). The id is signed in its canonical case and the
address is compared in lower case, because some mail systems change the
case of the local part. Inbound mail to a `reply+` address that doesn't
verify is rejected, and mail to any address other than the product's
`hello@` and its aliases is rejected too.

Inbound mail is parsed with postal-mime. Sent replies also carry
`Message-ID`, `In-Reply-To` and `References`, so they thread in the
recipient's mail client.

## Consequences

- Nobody can forge a reply onto an item without the secret.
- Rotating the secret breaks every outstanding reply address, so it is
  rotated only if it leaks.
- Replies that arrive without the `reply+` address, such as a fresh email,
  become new items rather than joining the thread.

## Screening record

| Dependency | Maintainer | On a list | Note |
|---|---|---|---|
| postal-mime | Postal Systems OÜ (Andris Reinman) | N | Checked 14 November 2026. |
