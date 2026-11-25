-- Links from an item to its product's own admin, filled from the item's context: [{"field","url"}], where url holds
-- one {value}. Each product's admin keeps every action on its own data; Engage only links to it.
ALTER TABLE products ADD COLUMN admin_links TEXT NOT NULL DEFAULT '[]';
UPDATE products SET admin_links = '[{"field":"reportedUsername","url":"https://admin.climbinglogbook.com/users?q={value}"}]'
WHERE slug = 'cl';
