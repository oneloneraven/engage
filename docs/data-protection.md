# Data protection: record of processing

What personal data Engage processes, why, where it goes and how long it's
kept. Keep this current: a change that collects new data or adds a processor
updates it in the same PR.

## Processors

| Processor | What it receives | Purpose | Location |
|---|---|---|---|
| Cloudflare (Workers, D1, R2, Email Routing, Email Sending, Turnstile, Access) | Everything Engage stores and sends: items, messages, attachments, testimonials, the blocklist and the audit log; inbound and outbound mail; web submitters' IP addresses and browser signals for Turnstile; the owner's sign-in | Hosting, storage, mail in and out, bot protection, admin sign-in | Cloudflare's global network; D1 and R2 aren't pinned to a jurisdiction |
| GitHub | Only what the owner deliberately puts in an issue after editing and redacting a draft, never contact details; the issue numbers of linked items | Tracking reported problems in each product's repository | United States |
| Proton (only for a product with backup forwarding turned on; none is) | A copy of every inbound email to that product | A backup mailbox while Engage is new | Switzerland |

Discord receives the kind of item, the product's name and a link, and no
personal data ([ADR-0005](adr/0005-content-free-notifications.md)), so it
isn't a processor.

## Processing activities

| Data | Purpose | Lawful basis | Retention | Who can see it |
|---|---|---|---|---|
| Feedback and issue reports: message, optional contact email and name, page or app section, app version, product-specific context, an opaque account reference | Understanding and fixing problems, and answering the person if they asked | Legitimate interests | 12 months after archiving, or after last activity if never archived (set per product); junk 30 days after it arrived. The account reference is cleared when the product deletes the account | The owner |
| Inbound email: sender address and name, subject, text and HTML bodies, attachments, SPF, DKIM and DMARC results | Answering people who write to a product | Legitimate interests | As above | The owner |
| Replies sent: the recipient's address and the reply text | Answering the person | Legitimate interests | Kept with the item, as above | The owner |
| Testimonials: an excerpt of the person's own words and an attribution in the form they chose (name, initials or anonymous) | Showing what people think on the product's site | Consent, recorded with the submission and withdrawable | Until withdrawn or the item is deleted | Public, on the product's site, without contact details |
| Web submitters' IP address and browser signals | Bot protection and rate limiting | Legitimate interests | Not stored by Engage; held by Cloudflare only as long as Turnstile and the rate limiter need | Cloudflare |
| Blocked senders: an email address or domain | Keeping repeat spam out of the inbox | Legitimate interests | Kept indefinitely: there is no way to remove an entry yet | The owner |
| Audit log: the owner's email, the action, the target's id and time | Accountability for every change | Legitimate interests | Kept indefinitely; never holds item content, and a deleted item leaves only its id | The owner |

## Gaps to settle

- **Blocklist entries have no retention.** Entries are personal data when
  they name an address, so they need a review or expiry period.
- **The audit log is kept indefinitely.** It holds only the owner's identity
  and item ids, but an indefinite period still needs a decision.
- **Data location isn't pinned.** D1 and R2 can take a jurisdiction; whether
  to pin them is open.
- **Each product's privacy page** must name Engage's processing before that
  product's forms and mail move to Engage.

## Security measures

See the [threat model](threat-model.md) and [privacy rules](privacy.md).
