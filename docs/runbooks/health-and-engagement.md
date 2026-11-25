# Turning on health and engagement

Home's product panels show each product's health, one engagement number and whether beta is ahead of production (design §8, [plan 3](../superpowers/plans/2026-11-25-engage-plan-3-health-engagement.md)). The code is live, but it needs credentials and registry config that only you can provide. Until each step is done, the panels say Unknown or leave that part out. Nothing is faked.

The steps are independent: each one switches on its own part.

## 1. Health from Better Stack

1. In Better Stack, create an API token for the team that holds the product monitors. Better Stack doesn't document a read-only token, so treat this one as able to change monitors.
2. Store it in Proton Pass as `Dev / engage / Better Stack API token`.
3. Set it as the `BETTER_STACK_TOKEN` secret of `oneloneraven/engage`'s **production** environment, then run the **Sync Worker secrets** workflow.
4. Find each monitor's id, from the monitor's page in Better Stack, or in Climbing Logbook with `tofu -chdir=infra state show betteruptime_monitor.app_ready` (and `home`, `beta_ready`).
5. Add the monitors to the registry in a migration (step 5 below). Each needs its id, the name to show ("Climbing Logbook app") and the link to open (the monitor's page in Better Stack).

Engage checks every five minutes. A product with no monitors says Not monitored; Deaftly has none until oneloneraven/deaftly-website#102.

## 2. Visits from Web Analytics

1. In Cloudflare, create an account API token with **Account Analytics: Read** and nothing else.
2. Store it in Proton Pass as `Dev / engage / Cloudflare analytics token`.
3. Set it as the `CLOUDFLARE_ANALYTICS_TOKEN` secret of the production environment, then run **Sync Worker secrets**. The Worker also needs `CLOUDFLARE_ACCOUNT_ID`, which the [release gate runbook](release-gate.md) sets.
4. Find each site's tag in the dashboard under **Web Analytics**, in the site's settings. Check whether deaftly.com has Web Analytics on at all; if it doesn't, it gets no visits entry.
5. Add a `web-visits` entry to the product's engagement in a migration (step 5).

The first daily run after this fills in the last 30 days, so the sparkline appears straight away.

## 3. Climbing Logbook's active climbers

1. Merge oneloneraven/climbing-logbook#1728. Its `infra/` change creates an Access service token for Engage, and CL accepts that token on its usage endpoint only.
2. Read the token's client id and secret from that apply's outputs, and store them in Proton Pass as `Dev / engage / CL usage service token`.
3. Set them as the `CL_USAGE_CLIENT_ID` and `CL_USAGE_CLIENT_SECRET` secrets of the production environment, then run **Sync Worker secrets**.

The registry entry for this is already in place (migration `0010`), so the number appears after the next daily run (03:17 UTC).

## 4. Deaftly's Android downloads

Nothing to do. It reads GitHub Release download counts for `oneloneraven/deaftly` through Engage's GitHub App, and its registry entry is in migration `0010`.

## 5. Registry config

Monitor ids and site tags go in a migration so they're reviewed, like this:

```sql
UPDATE products SET health_sources = '{"betterStack":{"monitors":[
  {"id":"<id>","name":"Climbing Logbook home page","url":"<monitor page>"},
  {"id":"<id>","name":"Climbing Logbook app","url":"<monitor page>"},
  {"id":"<id>","name":"Climbing Logbook beta","url":"<monitor page>"}
]}}' WHERE slug = 'cl';

UPDATE products SET engagement = json_insert(engagement, '$[#]', json('{"source":"web-visits","metric":"visits","label":"Visits in the last 30 days, excluding EU visitors","siteTag":"<site tag>"}'))
WHERE slug = 'cl';
```

Labels are shown as written, so say the window and, for visits, that EU visitors are excluded. One entry per product is `"primary": true`: that's the number its panel shows.

## Beta against production

Engage reads each environment's health endpoint for its version. It isn't configured yet, because Climbing Logbook's beta reports a Worker version id (`ad4a…`) rather than a release tag, so the two can't be compared. Once beta reports its tag, add the environments:

```sql
UPDATE products SET environments = '[
  {"name":"production","healthUrl":"https://my.climbinglogbook.com/-/api/health/ready"},
  {"name":"beta","healthUrl":"https://beta.climbinglogbook.com/-/api/health/ready"}
]' WHERE slug = 'cl';
```

The badge goes amber after `beta_amber_days` (7 by default, per product).

## Checking it works

- Health: within five minutes, Home's panel shows Healthy (or the real status) instead of Unknown.
- Engagement: after the next 03:17 UTC run, the number and sparkline appear. Until there are 25 days in each of two 30-day windows, there's no change figure.
- If a part stays empty, the Worker logs say which: `health.not-configured`, `health.unavailable`, `metrics.<source>.not-configured` or `metrics.<source>.failed` with an error code.
