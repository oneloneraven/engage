-- Each product's address in the admin UI: its base repository's name (product hubs design). slug stays the internal
-- key, because products' own integrations send it.
ALTER TABLE products ADD COLUMN route TEXT;
UPDATE products SET route = 'climbing-logbook' WHERE slug = 'cl';
UPDATE products SET route = 'deaftly' WHERE slug = 'deaftly';
CREATE UNIQUE INDEX products_route ON products (route);
