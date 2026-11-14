# Engage UI direction

**Subject:** One Lone Raven's lookout. One person keeps watch over their own small set of products and wants the state of things at a glance, then wants to act. The name gives the visual source: a raven's feathers are blue-black, with an oil-slick sheen of petrol blue and violet that shows only in the light. Engage is that: dark and quiet by default, iridescent only where something matters.

**The one bold thing:** the verdict on Home. A large display sentence, "All green." or "2 things need you.", with a feather-sheen underline (petrol to violet) that sweeps once on load. Everything else stays disciplined.

## Colour

Tokens on `:root`. Dark is the default when the system asks for it; light otherwise. Every text pairing meets WCAG 2.2 AA (4.5:1 body, 3:1 large and UI).

| Token | Dark | Light | Use |
|---|---|---|---|
| `--ink` | `#0F1420` | `#F3F5F9` | Page background: blue-black plumage / cool slate paper |
| `--surface` | `#171D2B` | `#FFFFFF` | Panels, the item view, inputs |
| `--line` | `#2A3346` | `#D5DAE4` | Dividers and borders |
| `--text` | `#E6E9F0` | `#141A26` | Body text |
| `--muted` | `#9AA3B5` | `#566079` | Secondary text and metadata |
| `--petrol` | `#3BB7C9` | `#0C7482` | Links, focus, selection: the first sheen colour |
| `--violet` | `#8B7CF6` | `#5B4BD6` | The second sheen colour: the verdict underline and active nav only |
| `--attention` | `#F2B544` | `#9A6400` | Needs you: reply owed, things waiting |
| `--danger` | `#F07178` | `#B4232F` | Delete, failed health, junk |
| `--ok` | `#5CCB8A` | `#1E7A47` | Healthy |

Light `--petrol` is `#0C7482`, a shade darker than first proposed (`#0E7C8C`), because the lighter value measured 4.48:1 against `--ink`, just under the 4.5:1 that links and primary buttons need.

The sheen gradient (`--petrol` to `--violet`) appears in exactly two places: the verdict underline, and the active navigation marker. Never as a background wash.

## Type

- **Display: Bricolage Grotesque** (variable; its optical size and width axes). Used for the verdict, page titles and product names only, so it carries the personality. The verdict is set large and tight (`clamp(2.5rem, 6vw, 4.5rem)`, weight 650, letter-spacing −0.02em).
- **Text: Atkinson Hyperlegible Next.** Built for legibility, and it reads as deliberate rather than default. Used for everything else at 1rem/1.55, with metadata at 0.875rem in `--muted`.
- Both are self-hosted through Fontsource (the CSP is `self` only), as WOFF2, with `font-display: swap`.
- Sentence case everywhere. No all-caps labels, no eyebrows, no monospace for data.

Scale (1.25 ratio): 0.875 · 1 · 1.25 · 1.563 · 1.953 · 2.441 rem, plus the verdict's fluid size.

## Layout

```
Desktop                                        Mobile
┌──────┬──────────────────────────────────┐    ┌────────────────────┐
│ Home │  2 things need you.              │    │ ☰  Engage          │
│ Inbox│  ~~~~~~~~~~~~~~~~ (sheen)        │    │ 2 things need you. │
│ Junk │                                  │    │ ~~~~~~~~~~~        │
│      │  Needs you                       │    │ Needs you          │
│ ──── │  ● Reply owed: "Map is blank" CL │    │ ● Reply owed …     │
│ CL   │  ● Reply owed: "Love it" Deaftly │    │ 3 new · 5 open     │
│ Deaft│                                  │    │ ┌ Climbing Logbook ┐│
│      │  3 new   5 open   2 reply owed   │    │ └──────────────────┘│
│      │                                  │    └────────────────────┘
│      │  ┌ Climbing Logbook ┐┌ Deaftly ┐ │
│      │  └──────────────────┘└─────────┘ │
└──────┴──────────────────────────────────┘
```

- **Left rail** (desktop): the pages, then the products, which act as an inbox filter. It becomes a top bar with a menu on narrow screens. The active item gets a 3px sheen bar on its left edge.
- **Home:** the verdict, then **Needs you** as a plain list (one row per thing, a coloured dot for its kind, the product name right-aligned), then the counts as three large numerals with plain labels, then one card per product. The product cards are the only cards on the page.
- **Inbox:** two panes on wide screens (list left at 24rem, item right), like a mail client, and one pane on narrow screens. List rows aren't cards: a divider between rows, unread rows in weight 600 with a petrol dot, junk never shown here.
- **Item:** a header (subject or first line, product, kind, received), then the thread. Each message is a block with a one-line header (who, when) and the text below in a readable measure (≤70ch). Inbound and outbound are told apart by a left border: `--line` for theirs, `--petrol` for yours. No chat bubbles. The actions sit in a toolbar under the header: Reply, Create GitHub issue, Quote, Star, Archive, and Delete pushed to the far end in `--danger`.
- Content is left-aligned throughout. Nothing is centred except empty states.

## Components

- **Radii by role:** 6px for controls (buttons, inputs, chips), 12px for panels and product cards, and none for list rows. No drop shadows: depth comes from `--surface` against `--ink`.
- **Buttons:**
  - Primary: `--petrol` fill with `--ink` text.
  - Secondary: a 1px `--line` border with `--text`.
  - Destructive: a `--danger` border; filled only inside its confirmation step.
  - Labels say what happens: "Send reply", "Create issue", "Delete for good".
- **Focus:** a 2px `--petrol` outline with a 2px offset on everything focusable. Never removed.
- **Health dot:** a 10px dot (`--ok`, `--attention` or `--danger`), always paired with a word ("Healthy", "Errors"), never colour alone.
- **Confirmations:** delete asks inline in the toolbar ("Delete this and its quotes for good?" with "Delete for good" and "Keep it"), not in a modal.
- **Empty states:** one sentence and, where there is one, the next action. For example: "Nothing needs you. New feedback lands here and pings Discord."
- **Inbound HTML:** shown only on request ("Show formatted"), in a sandboxed frame with a `--line` border, a white page whatever the theme (email is written for one), and the caption "Formatted view". Remote images and links don't load in it, by design.

## Motion

- One orchestrated moment: on Home's first paint, the verdict's sheen underline sweeps left to right over 600ms. Nothing else animates on load.
- Responses to actions: a 150ms fade when a row leaves the list after archiving, and the composer expands when opened.
- `prefers-reduced-motion` removes all of it.

## Copy

Second person, plain verbs, sentence case. Errors say what happened and what to do. For example: "Couldn't send: this person didn't leave an email address." "GitHub refused the issue (it may be down): try again in a minute."
