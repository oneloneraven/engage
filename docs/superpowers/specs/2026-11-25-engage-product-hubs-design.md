# Engage: product hubs

Status: approved by the maintainer on 25 November 2026 (#126). Amends design §7 (Home) and `docs/ui.md` (The shell, Home, Inbox).

## Why

Engage tries to show every product at once on every page. The rail, the list and the item pane fight for one row, so the toolbar wraps, the inbox's filter chips don't fit, and product filters repeat what the rail already offers. Work on a product happens inside that product, so the layout should be organised around products, not around kinds of data.

## Goals

- A central hub that says, product by product, what needs you and how each one is doing.
- A hub per product with its own inbox, releases, health and usage, using the full width.
- Adding a product, Beyond Borders next, is a registry row plus any pages unique to it.

## Non-goals

- New data. Every number already exists (Module 1–3); this changes where it's shown.
- Conformance (Module 4) beyond reserving its place.

## Anti-goals: it fails if…

- Something needs you and you can't tell from the central hub.
- Finding a message means remembering which product it was for.
- A product's page disappears because it isn't set up yet. You can't tell "not set up" from "missing".
- Adding a product means copying UI code.

## Approaches

1. **Product hubs under a central hub (chosen).** The hub shows one card per product, each with its own "needs you", and each product has a hub of tabs. The product filters go, because a hub is the filter.
2. **Keep the cross-product layout and fix it in place.** Product filters become a dropdown and the panes are tuned. This is cheaper, but it keeps three panes in one row and the cross-product "needs you" mix the maintainer finds less clear.
3. **Product hubs with no central overview.** This is the simplest routing, but nothing tells you at a glance whether everything is fine. That fails the first anti-goal.

## The design

### URLs

- `/` is the central hub.
- `/<product>` is the product's overview, and `/<product>/<page>` is one of its pages, e.g. `/climbing-logbook/inbox`, `/deaftly/releases/<id>`.
- `<product>` is a new registry column, `route`: the base repository's name (`climbing-logbook`, `deaftly`, `beyond-borders`). The existing `slug` (`cl`) stays as the internal key, because Climbing Logbook's live integration sends it (`/v1/accounts/cl/…`, submissions, the testimonials feed). Deaftly's website stays one of Deaftly's gated repositories, not a product.
- `/items/<id>` keeps working, because Discord pings and shared links point there. It redirects to the item in its product's inbox.
- `/search?q=` searches every product (below).
- `route` must match `^[a-z0-9-]+$` and isn't one of the reserved names (`search`, `items`, `api`, `assets`).

### Shell

- **No rail.** A top bar across the full width holds the wordmark (a link to `/`), then, inside a product, a product switcher ("Climbing Logbook ▾") that lists every product with its colour square, then search, which works across all products, at the far end.
- Content uses the full width, with the fluid side margin as now.

### Central hub (`/`)

1. The date, then the verdict as now ("3 things need you."), totalled across products, with a one-line sentence under it.
2. **One card per product, in a single column**, in registry order. The order stays the same however busy a product is, so you always know where each one sits. A card that needs you gets an `--attention` edge.
3. Each card has a header (colour square, name, health pill, "Open Climbing Logbook") and two columns from 900px wide, one column below:
   - **Left, what needs you:** that product's rows (failing health, releases waiting, replies owed), each with its actions as now, then counts (new, open). With nothing to do: "Nothing needs you here."
   - **Right, how it's doing:** the engagement number with its sparkline and change, the beta badge, and the latest release.

### Product hub (`/<product>`)

- **A tab bar under the product's name** from 768px wide. Below that, a single menu button names the current page ("Inbox ▾").
- **Foundation pages**, which every product has, in this order:

| Page | Shows | When it isn't set up |
|---|---|---|
| Overview | The product's card, full width, with the latest activity | Never unset |
| Inbox | Feedback, issue reports and email, with Junk as a view | "Nothing yet. Feedback from <domain> arrives here once its forms post to Engage." |
| Releases | Waiting, approved and rejected releases for its repositories | "No repositories are gated yet. Turning on the release gate: <runbook>." |
| Health | Each monitor with its status and reason | "No monitors yet. Turning on health: <runbook>." |
| Usage | Each engagement metric, 90 days, with its sparkline | "No usage source yet. Turning on engagement: <runbook>." |

  An unset page is always shown. It says plainly what it would show and links to how to set it up.
- **Product pages:** a product can add pages for what only it has, such as Climbing Logbook's breakdown of climbs by status and discipline. Each is a small module registered against the product's `route`, `{ path, title, mount }`, and appears as a tab after the foundation pages. Foundation pages never need product code.
- **Inbox:** the list and the open item side by side, as now, but with the rail's width back: list 26–32rem, and the item gets the rest. No product chips: the filters are All, Reply owed and More filters (kind, archived, junk).

### Search

The top bar's search goes to `/search?q=`, which lists matching items from every product, each with its product's colour square and name. Opening one goes to the item in its product's inbox.

### Adding Beyond Borders

A registry row (slug, `route: beyond-borders`, domains, colour) gives it a card and a hub straight away. Every foundation page shows its "isn't set up" state until its forms, monitors and analytics are connected. Its own onboarding, forms posting to Engage and its repository's gate, is separate work.

## Decided by the maintainer

- Product hubs under a central hub; each card carries its own "needs you".
- Search across all products.
- A fixed set of foundation pages, always shown, plus pages unique to each product.
- Actionable things on the left of a card, analytics on the right.
- Product routes are the base repository's name.

## Calls made here, for review

- `route` is a new column, and `slug` stays the internal key, so nothing breaks for Climbing Logbook.
- Cards stay in registry order, with an attention edge, rather than sorting by urgency.
- Junk becomes a view of each product's inbox, not a top-level page.
- Narrow screens get one menu button for the tabs, not a scrolling tab bar.

## Left to the builder

- How the product switcher and the narrow-screen menu are built, within `docs/ui.md`.
- How each product's hub fetches its data. Expect an `/api/products/<route>` summary plus the existing APIs filtered by product.

## Delivery

1. Registry `route`, the top bar, and the central hub with per-product cards; the rail goes (#127).
2. Product hub: tabs, Overview and Inbox under `/<product>`, the `/items/<id>` redirect, and search (issue to follow).
3. Releases, Health and Usage pages, with their "isn't set up" states (#128).
4. Product pages: the registration contract, with Climbing Logbook's breakdown as the first (issue to follow).
5. Beyond Borders' registry row (#129); its onboarding is tracked separately.
