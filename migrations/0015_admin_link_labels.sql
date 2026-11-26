-- Climbing Logbook's admin opens one climb at /entries/<id> (oneloneraven/climbing-logbook#1743). Each template's label
-- names what it opens, so an item with both fields shows two buttons that read differently.
UPDATE products SET admin_links = '[{"field":"reportedUsername","url":"https://admin.climbinglogbook.com/users?q={value}","label":"user"},{"field":"reportedEntryId","url":"https://admin.climbinglogbook.com/entries/{value}","label":"climb"}]'
WHERE slug = 'cl';
