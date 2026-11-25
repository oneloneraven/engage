-- Each product's headline engagement number (design §8). Visits and monitors follow once their ids are known
-- (docs/runbooks/health-and-engagement.md). Secrets stay in Worker secrets.
UPDATE products SET engagement = '[{"source":"cl-usage","metric":"active-users","label":"People who logged a climb in the last 30 days","url":"https://admin.climbinglogbook.com/-/api/admin/usage","field":"activeUsers","primary":true}]'
WHERE slug = 'cl';

UPDATE products SET engagement = '[{"source":"github-downloads","metric":"downloads","label":"Android downloads in the last 30 days","repo":"oneloneraven/deaftly","assetPattern":"\\.apk$","primary":true}]'
WHERE slug = 'deaftly';
