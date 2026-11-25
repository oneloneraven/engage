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

Each product has its own fire colour, used for its square in the rail, its filter chip, its avatar tint in the inbox, its product panel's glow and its sparkline. A product's colour is never the only way to tell it apart: its name is always beside it.

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
Desktop (≥ 1200px)
┌────────────┬────────────────────────────────────────────────────────┐
│ ▲ Engage   │ Wednesday 25 November          [ Search messages  / ] │
│            │                                                        │
│ Home       │ 3 things need you.                                     │
│ Inbox    4 │ ━━━━━━━━━━━━━━━━ (fire, sweeps once)                   │
│ Releases 1 │ A release is waiting and two people are owed a reply.  │
│ Junk       │ ┌────────────────────────────────────────────────────┐ │
│            │ │ ⬇ CL 1.14.0 is waiting for production [Review][Approve]│
│ Products   │ │ ↩ The map is blank                          [Reply]│ │
│ ■ Climbing │ │ ↩ App closes when I rotate                  [Reply]│ │
│ ■ Deaftly  │ └────────────────────────────────────────────────────┘ │
│            │ (4 new) (27 open) (2 replies owed)                     │
│            │ Your products                                          │
│            │ ┌ Climbing Logbook  Healthy ┐ ┌ Deaftly       Healthy ┐ │
│            │ │ 38 weekly climbers  ╱╲╱╱  │ │ 126 downloads   ╱╲╱╱  │ │
│            │ │ 3 new  22 open  Beta ahead│ │ 1 new  5 open         │ │
│            │ └───────────────────────────┘ └───────────────────────┘ │
└────────────┴────────────────────────────────────────────────────────┘
```

### The shell

- **Rail** (desktop, 232–260px): the wordmark with its fire tile, then the pages, then the products. Inbox carries a count of new items in an `--accent` badge; Releases carries the number waiting in an `--attention` badge. Products show their colour square and filter the inbox. The current page has a `--raised`-strength light tint behind it and `aria-current="page"`.
- **Below 1200px** the rail becomes a top bar: the wordmark, the badges, and a menu button (`aria-expanded`) that opens the full navigation as a sheet.
- Main content is left-aligned with a fluid side margin (`clamp(1.25rem, 5vw, 4.5rem)`), capped at 74rem on Home. Nothing is centred except empty states.

### Home

1. A slim top row: today's date in `--muted`, and a search button that takes you to the inbox with its search box focused.
2. **The verdict**, the fire underline and one plain sentence that says what the things are ("A release is waiting and two people are owed a reply. Everything else is quiet."). With nothing to do: "All clear." and "Nothing needs you. New feedback lands here and pings Discord."
3. **Needs you:** one panel holding a row per thing, most urgent first (failing health, releases waiting, replies owed, conformance failures as those modules arrive). Each row has a 44px icon tile tinted in its kind's colour, a bold title, one line of context in `--muted`, and its actions on the right: the primary action as a filled button, a secondary one outlined. A release row sits on an `--attention` tint. Actions:
   - Release waiting: Review (opens the approval page) and Approve release.
   - Reply owed: Reply, which opens the item with the composer open (`/items/<id>?reply`).
   - Failing or degraded health: the product and its status as the title, the reason as context, and Open in Better Stack (outlined, in a new tab) when there's a link.

   The verdict's number is the number of rows here. Nothing else adds rows: there's no "worth quoting" signal, so Quote stays in the item toolbar.
4. **Counts** as three pills: a display-type number and a plain label (new, open, replies owed), each linking to the inbox with that filter.
5. **Your products:** a responsive grid (`repeat(auto-fit, minmax(min(100%, 26rem), 1fr))`) of product panels. Each panel: name, a health pill (dot plus word: Healthy, Degraded, Failing), one engagement number with its 30-day sparkline and change ("up 12% on last month"), then chips for new and open counts and a beta badge. The panel has a soft radial glow of its product colour from the top-right corner.
   - The health pill also says Not monitored (no monitors configured) or Unknown (the source couldn't be read, or the last check is over 15 minutes old). Neither is ever shown as Healthy. Under the name, a muted line gives the reason for anything other than Healthy or Not monitored.
   - The engagement number is in display type with its label beneath, then the sparkline in the product colour, then the change. A product with no engagement source leaves the block out; one with a source but no data yet says "No data yet". The change appears only once both 30-day windows have at least 25 days of data.
   - The beta badge appears only when beta runs a different version from production: "Beta v1.15.0, 3 days ahead of production". It's outlined, and takes the `--attention` tint once beta has been ahead for longer than the product's `beta_amber_days` (7 by default).

### Inbox

- **Three panes from 1200px:** rail, message list (22–32rem, a third of the width) and the open item. **Two panes from 768px:** list and item, under the top bar. **One pane below 768px:** the list, then the item with a back link.
- **List header:** the page title with the new count beside it; the search field with a "More filters" icon button at its end (kind and archived); then one row of filter chips (`aria-pressed`): All, one chip per product with its colour square, and Reply owed. This replaces the four stacked selects.
- **Rows:** a 36px avatar in the product's tint showing the sender's initial (a "?" when there's no name), the subject (weight 700 when unread), the time, one line of preview in `--muted`, then small tags (Reply owed, Issue report, Starred). A tag never repeats the title: a row titled "Issue report" has no Issue report tag. The open row sits on `--raised`. No dividers; rows are separated by space and the selection tint.
- `/inbox` and `/items/<id>` are the same split layout: the list stays put while items open beside it, and `/items/<id>` stays a link you can share with yourself. With nothing open, the item pane says how many are new and unread, and opens nothing by itself, because opening an item marks it read. On a phone, the list shows first.
- The chips map onto the inbox's existing filters (product, state and kind): Reply owed is the reply-owed state, and "More" holds kind and the archived view. Search is the inbox's existing search.

### Item

- **Header:** chips for the product, the kind and source ("Issue report from the app"), and any state ("Reply owed: the linked issue closed 2 days ago"); then the subject in display type; then the toolbar. When it arrived, where from and who sent it all sit together in Details, under the thread.
- **Toolbar:** one row of 44px icon buttons, so it fits however narrow the item pane gets: Reply (filled, primary), Create GitHub issue or View GitHub issue #n (GitHub's mark), Star (filled when starred), Archive, Quote, and Delete pushed to the far end in `--danger`. Each has its name as its accessible name and tooltip. Delete confirms inline, as now.
  - An unavailable action is disabled in place, never as a filled primary, and the reasons sit in one muted line under the toolbar ("No contact email. No consent to quote."), so they don't move the buttons.
- **Thread:** messages in a ≤72ch column. Theirs sit on `--surface` with a `--line` border; yours sit on an `--accent` tint with an `--accent` border at 22%. Each has a one-line header (who and how, then the time) in `--muted`.
- **Composer:** docked at the bottom of the item pane, on `--surface`. Its label says who it goes to and from which address ("Reply to Alex from hello@climbinglogbook.com"). Actions: Discard and Send reply.
- **Formatted view** of inbound HTML stays as it is now: on request, in a sandboxed frame on a white page, captioned "Formatted view".

### Junk

The inbox layout without the filter chips. Each row has Not junk and Delete for good. Junk uses `--danger` only on the delete action, never on the rows.

### Releases (for Module 2)

The Releases page, its rail entry and Home's release rows arrive with Module 2, not before. A list shaped like the inbox: one row per release waiting, showing the product colour, the repository, the environment, the version and how long it's been waiting. The open release shows the PRs included since the last approved release, CI status and a link to the run, with Approve release (primary) and Reject (outlined, with an optional note). Its exact design is settled when Module 2 is built, within this direction.

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
