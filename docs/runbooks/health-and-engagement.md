# Turning on health and engagement

Home's product panels show each product's health, one engagement number and whether beta is ahead of production (design §8, [plan 3](../superpowers/plans/2026-11-25-engage-plan-3-health-engagement.md)). The code is live, but it needs credentials and registry config that only you can provide. Until each step is done, the panels say Unknown or leave that part out. Nothing is faked.

The steps are independent: each one switches on its own part.

## 1. Health from Better Stack

This section is kept in the private vault.

## 2. Visits from Web Analytics

This section is kept in the private vault.

## 3. Climbing Logbook's active climbers

This section is kept in the private vault.

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
