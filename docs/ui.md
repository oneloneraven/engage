# Engage UI direction: Ember

**Subject:** One Lone Raven's control centre. One person runs a small set of products and opens Engage to find out what needs them, then deal with it. It should feel like a tool built for exactly that: fast, confident and alive, not a dashboard you read and close.

**The idea:** monochrome with fire. Neutral greys carry everything that's just information. Fire colours, from ember red through flame orange to gold, mark only what matters: something needs you, a product's identity, the one thing to press.

**The one bold thing:** the verdict on Home. A huge display sentence, "All clear." or "3 things need you.", with a fire underline (ember red to gold) that sweeps once on load. Directly under it, the things that need you, each with its action on the row, so Home is somewhere you act, not just read.

**Rules:**

- **No blue, ever.** No navy, blue-black, cyan, petrol or teal, and no violet. Check every new colour's hue before using it.
- Fire means something. Never use a fire colour as decoration on something that isn't asking for attention, isn't a product's identity, and isn't the primary action.
- No drop shadows. Depth comes from stepped greys and a 1px light border.

## Colour

Tokens on `:root`. Dark is the default when the system asks for it, and light otherwise. Both themes are first-class: the axe checks run in both.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--ink` | `#101010` | `#F4F4F4` | Page background |
| `--surface` | `#1A1A1A` | `#FFFFFF` | Panels, messages, the composer |
| `--raised` | `#242424` | `#EBEBEB` | Hover and selected rows, inputs |
| `--line` | `rgb(255 255 255 / 8%)` | `#D6D6D6` | Borders and dividers |
| `--text` | `#F5F5F5` | `#141414` | Body text |
| `--muted` | `#A8A8A8` | `#595959` | Secondary text and metadata |
| `--accent` | `#FFB23F` | `#A34A00` | Links, focus rings, the selected filter, the inbox count badge |
| `--attention` | `#FF7A1A` | `#B84A00` | Needs you: release waiting, reply owed, health degraded. Fills, dots and borders |
| `--attention-text` | `#FFB27A` | `#9C3F00` | Attention as text, including on attention tints |
| `--danger` | `#FF6B5E` | `#C42B1C` | Delete, health failing, junk |
| `--primary` | `#F5F5F5` | `#141414` | Primary button fill |
| `--on-primary` | `#101010` | `#FFFFFF` | Primary button text |
| `--fire` | `#FF3D1F → #FF8A1A → #FFD23F` | same | The verdict underline and the logo tile only |

Measured contrast (WCAG 2.2 AA needs 4.5:1 for body text and 3:1 for large text and UI):

| Pairing | Dark | Light |
|---|---|---|
| `--text` on `--ink` / `--surface` / `--raised` | 17.45 / 15.96 / 14.24 | 16.75 / 18.42 / 15.45 |
| `--muted` on the same | 8.00 / 7.32 / 6.53 | 6.37 / 7.00 / 5.88 |
| `--accent` on the same | 10.59 / 9.69 / 8.64 | 5.40 / 5.94 / 4.98 |
| `--attention-text` on the same | 10.78 / 9.86 / 8.80 | 6.11 / 6.72 / 5.64 |
| `--danger` on the same | 6.81 / 6.23 / 5.56 | 5.15 / 5.66 / 4.75 |
| `--on-primary` on `--primary` | 17.45 | 18.42 |
| Dark text `#1A1206` / white on `--attention` | 7.11 | 5.23 |

`--attention` itself drops to 4.38:1 on light `--raised`, so as text it's always `--attention-text`. Tints (a fire colour at up to 16% opacity behind a chip or row) take their `-text` colour for any words on them.

### Product colours

Each product has its own fire colour, used for its square on its hub card, its filter chip, its avatar tint in the inbox, its card's glow and its sparkline. A product's colour is never the only way to tell it apart: its name is always beside it.

| Product colour | Dark | Light | Dark text | Light text |
|---|---|---|---|---|
| Gold (Climbing Logbook) | `#FFC93C` | `#8A6100` | `#FFE08A` | `#7A5500` |
| Flame (Deaftly) | `#FF4D2E` | `#C7341A` | `#FF9A85` | `#B02E17` |

The fill colours pass 3:1 against every background in both themes (lowest: light Flame on `--raised`, 4.48:1). The text colours pass 4.5:1 everywhere (lowest: light Gold text on `--raised`, 5.63:1). A third product takes Ember (a deep red) or Amber, and its values are measured the same way before they're added here.

## Type

- **Display: Bricolage Grotesque**, heavy and tight. Used for the verdict, page titles, item subjects, product names, and the numbers in count pills and product panels.
  - Verdict: `clamp(3rem, 7vw, 6.5rem)`, weight 750, line-height 0.95, letter-spacing −0.035em.
  - Page title: 2.5rem, weight 750, −0.03em. Item subject: `clamp(2rem, 4vw, 3.25rem)`, same weight.
  - Product name: 1.875rem, weight 700, −0.02em. Section heading: 1.75rem, weight 650.
- **Text: Atkinson Hyperlegible Next** for everything else: 1rem/1.5 body, 1.25rem for the line under the verdict, 0.875rem for metadata and chips.
- Both stay self-hosted through Fontsource, as now.
- Sentence case everywhere. No all-caps, no eyebrow labels, no monospace for data.

## Layout

```
Desktop
┌──────────────────────────────────────────────────────────────────────┐
│ ▲ Engage                                           [ Search messages ] │
├──────────────────────────────────────────────────────────────────────┤
│ Wednesday 25 November                                                │
│ 4 things need you.                                                   │
│ ━━━━━━━━━━━━━━━━ (fire, sweeps once)                                 │
│ Climbing Logbook has 3 and Deaftly has 1.                            │
│ ┃┌ ■ Climbing Logbook                               ● Degraded ────┐ │
│ ┃│ Needs you                          │ How it's doing             │ │
│ ┃│ ⬇ v2.146.0 waiting  [Review][Approve] │ 38                     │ │
│ ┃│ ♥ Beta is recovering   [Better Stack] │ People who logged… ╱╲╱ │ │
│ ┃│ ↩ The map is blank          [Reply]   │ Up 12% on last month   │ │
│ ┃│ (4 new) (22 open)                     │ Beta v2.146.0, 9 days… │ │
│ ┃└────────────────────────────────────────────────────────────────┘ │
│ ┃┌ ■ Deaftly                                   ● Not monitored ─────┐ │
│ ┃│ ↩ Feedback from Sam         [Reply]   │ 126 downloads   ╱╲╱╱   │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### The shell

- **No rail.** A sticky top bar runs the full width: the wordmark with its fire tile (a link to Home), then, inside a product, the product switcher (its colour square and name, opening a list of every product), and Search at the far end. Releases live in each product's hub, and Home shows every release waiting on its product's card.
- **Below 768px** search keeps only its icon.
- Main content is left-aligned with a fluid side margin, capped at 74rem on Home. Nothing is centred except empty states.

### Product hub

- `/<route>` (for example `/climbing-logbook`) is a product's hub: its colour square and name as the page's `h1`, its health pill, then a tab bar of its foundation pages (Overview, Inbox, Releases, Health, Usage), with the current tab underlined in the product colour. Below 768px the tabs become one menu button naming the current page.
- **Overview** is the product's card from Home, full width.
- Every foundation page shows for every product. A page that isn't set up says what it would show and links to the runbook that turns it on, in a dashed box: "No repositories are gated yet.", "No monitors yet.", "No usage source yet."
- **Health** (`/<route>/health`): the health reason and when it was last checked, then one row per configured monitor with a status dot, its name, its status (Up, Down, Recovering, Open incident, Paused, Waiting for its first check, In maintenance, Not in Better Stack, Unknown) and Open in Better Stack. Every monitor is Unknown while the last check is over 15 minutes old.
- **Usage** (`/<route>/usage`): one card per engagement figure, each with its 30-day number, its change, and a 90-day sparkline in the product colour.
- **A product's own pages** come after the foundation tabs. Each is registered against the product's route in `src/ui/products/registry.js` as `{ path, title, mount }`, with what it reads on the server in `src/products/pages.js`. An own page can never take a foundation page's path. Own pages show figures and link out to the product's admin for anything that acts on its data.
- **Climbs** (Climbing Logbook, `/climbing-logbook/climbs`): every climb logged, then two cards, By status and By discipline, each part with its share and count over a bar in the product colour, and a link to Usage in Climbing Logbook's admin. Until Engage can read Climbing Logbook's usage, it shows its set-up state.
- `/items/<id>`, the address Discord pings and older links use, opens the item inside its product's inbox. The old `/inbox?product=<slug>` goes to that product's inbox, and any other `/inbox` to Search.

### Search

`/search?q=` lists matching messages from every product, each with its product's colour square and name, and opens a result in its product's inbox.

### Home: the central hub

1. **The verdict**: today's date in `--muted`, then the number of things that need you across every product, the fire underline, and one sentence per product ("Climbing Logbook has 3 and Deaftly has 1. Beyond Borders is quiet."). With nothing to do: "All clear." and "Nothing needs you. New feedback lands here and pings Discord."
2. **One card per product, in a single column**, in registry order. Order never changes with how busy a product is. A card with something that needs you has a 4px `--attention` edge on its left.
   - **Header:** the product's colour square and name (a link to its inbox until its hub lands), and its health pill.
   - **Left, Needs you:** that product's rows, most urgent first: failing or degraded health, releases waiting, then up to three replies owed with "See all n replies owed in the inbox" beyond that. Each row has a 44px icon tile, a bold title, one line of context in `--muted`, and its actions: Review and Approve release for a release, Reply for a reply owed, and Open in Better Stack for health. A release row sits on an `--attention` tint. Under the rows, chips for new and open messages. With nothing to do: "Nothing needs you here."
   - **Right, How it's doing:** the engagement block, the health reason when it's Unknown, the beta badge, and the latest release approved ("Latest release: v1.14.0 to production, 20 Nov 2026.", linking to it). With no engagement source: "No usage figures yet."
   - The two sides sit side by side from 1024px wide and stack below. The card keeps its soft radial glow of the product colour from the top-right corner.
   - The health pill also says Not monitored (no monitors configured) or Unknown (the source couldn't be read, or the last check is over 15 minutes old). Neither is ever shown as Healthy.
   - The engagement number is in display type with its label beneath, then the sparkline in the product colour, then the change. A product with a source but no data yet says "No data yet". The change appears only once both 30-day windows have at least 25 days of data.
   - The beta badge appears only when beta runs a different version from production: "Beta v1.15.0, 3 days ahead of production". It's outlined, and takes the `--attention` tint once beta has been ahead for longer than the product's `beta_amber_days` (7 by default).

### Inbox

- **Two panes from 768px**, under the top bar: the message list (22–32rem, a third of the width) and the open item. **One pane below 768px:** the list, then the item with a back link.
- **Inside a product's hub**, at `/<route>/inbox` and `/<route>/inbox/<id>`. Rows don't repeat the product's name; the hub already says it.
- **List header:** the search field with a "More filters" icon button at its end (kind and archived); then one row of chips: All and Reply owed (`aria-pressed`), and Junk, which opens the product's junk.
- **Rows:** a 36px avatar in the product's tint showing the sender's initial (a "?" when there's no name), the subject (weight 700 when unread), the time, one line of preview in `--muted` (the first line of what they wrote, cut short; left out when there's no text or it only repeats the subject), then small tags (Reply owed, Issue report, Starred). A tag never repeats the title: a row titled "Issue report" has no Issue report tag. The open row sits on `--raised`. No dividers; rows are separated by space and the selection tint.
- `/inbox` and `/items/<id>` are the same split layout: the list stays put while items open beside it, and `/items/<id>` stays a link you can share with yourself. With nothing open, the item pane says how many are new and unread, and opens nothing by itself, because opening an item marks it read. On a phone, the list shows first.
- The chips map onto the inbox's existing filters (state and kind): Reply owed is the reply-owed state, and "More filters" holds kind and the archived view. The search field searches this product; Search in the top bar searches every product.

### Item

- **Header:** chips for the kind and source ("Issue report from the app"), and any state ("Reply owed: the linked issue closed 2 days ago"); then the subject in display type; then the toolbar. When it arrived, where from and who sent it all sit together in Details, under the thread.
- **Toolbar:** one row of 44px icon buttons, so it fits however narrow the item pane gets: Reply (filled, primary), Create GitHub issue or View GitHub issue #n (GitHub's mark), Star (filled when starred), Archive, Quote, and Delete pushed to the far end in `--danger`. Each has its name as its accessible name and tooltip. Delete confirms inline, as now.
  - An unavailable action is disabled in place, never as a filled primary, and the reasons sit in one muted line under the toolbar ("No contact email. No consent to quote."), so they don't move the buttons.
- **Thread:** messages in a ≤72ch column. Theirs sit on `--surface` with a `--line` border; yours sit on an `--accent` tint with an `--accent` border at 22%. Each has a one-line header (who and how, then the time) in `--muted`.
- **Composer:** docked at the bottom of the item pane, on `--surface`. Its label says who it goes to and from which address ("Reply to Alex from hello@climbinglogbook.com"). Actions: Discard and Send reply.
- **Formatted view** of inbound HTML stays as it is now: on request, in a sandboxed frame on a white page, captioned "Formatted view".

### Junk

A view of each product's inbox, at `/<route>/inbox?state=junk`, with a link back to the inbox. The inbox layout without the filter chips. Each row has Not junk and Delete for good. Junk uses `--danger` only on the delete action, never on the rows.

### Releases

Each product's releases, at `/<route>/releases` and `/<route>/releases/<id>`, plus the release rows on its card. A list shaped like the inbox: Waiting first, each row with the version, the environment, the repository and how long it's been waiting; then Earlier, with the date and its state (Approved, Rejected, Expired, Went out). The open release shows the PRs included since the last approved release, CI status and a link to the run, with Approve release (primary) and Reject (outlined, with an optional note). `/releases/<id>`, which Discord pings link to, opens the release in its product's hub, and `/releases` goes to Home.

## Components

- **Radii by role:** 12px for buttons, inputs and icon tiles; 14px for list and queue rows; 20px for the needs-you panel and thread messages; 24px for product panels; fully round for chips, pills and badges.
- **Buttons**, all at least 44px tall:
  - Primary: `--primary` fill, `--on-primary` text, weight 700. One per row or toolbar.
  - Attention primary, for Approve release only: `--attention` fill with dark text in dark theme and white text in light.
  - Secondary: a 1px border at 14% of `--text`, `--text` label, no fill.
  - Destructive: a `--danger` border and label; filled only inside its confirmation.
  - Labels say what happens: "Send reply", "Approve release", "Delete for good".
- **Chips:** 36px tall, fully round. Selected: `--text` fill, `--ink` label. Unselected: a `--line` border.
- **Health pill:** neutral fill with a dot and a word. Dot: `--text` for Healthy, `--attention` for Degraded, `--danger` for Failing.
- **Focus:** a 2px `--accent` outline with a 2px offset on everything focusable. Never removed.
- **Sparklines:** a 3px line in the product colour with a 12% fill below. Each sparkline has `role="img"` and a label that says what it shows and which way it's going.
- **Empty states:** one sentence and the next action, if there is one. Never styled as an error.

## Depth and atmosphere

- The page background carries one faint radial ember glow from the top-right (dark: `#3A1708` fading to `--ink`; light: `--attention` at 8% fading out). It's the only gradient wash.
- Product panels carry their own product-colour glow. Nothing else has a gradient except the fire underline and the logo tile.
- Panels use `--surface` against `--ink` with a 1px `--line` border; the needs-you panel adds a top-to-bottom sheen from 6% to 2.5% white (dark theme only).

## Motion

- One orchestrated moment: on Home's first paint, the fire underline sweeps left to right over 700ms with an ease-out.
- Responses to actions: a 150ms fade and collapse when a row leaves the queue or the list, and the composer expands when opened.
- `prefers-reduced-motion` removes all of it.

## Copy

Second person, plain verbs, sentence case. The verdict's summary sentence names the kinds of thing waiting. Errors say what happened and what to do: "Couldn't send: this person didn't leave an email address." "GitHub refused the issue (it may be down): try again in a minute."

## Building it

- **Approach:** restyle in place. The UI stays vanilla JavaScript modules (`src/ui/`) with one stylesheet built on these tokens. Adopting a component framework or a utility-CSS framework was considered and rejected: neither fixes what's wrong (the direction and the layouts), and both add bundle weight and a dependency to screen for one user's admin tool.
- **Product colour** becomes a column on the `products` table, holding one of the named product colours, and the admin API returns it with each product, so the UI never hard-codes a product. A product with no colour, or one the UI doesn't know, shows `--muted` instead.
- **Tests:** the end-to-end and axe suites cover every page in both themes at phone and desktop widths, as the [coding standards](coding-standards.md#web-app) already require. Health, engagement, sparklines and the beta badge are built with Module 3, not now.
- **Home's needs-you actions** reuse the existing item, quote and reply operations. Approve release arrives with Module 2.
- The mockups (Home, and Inbox with an item open) are on the maintainer's private design canvas. They use sample data; this document is the source of truth where the two differ.
