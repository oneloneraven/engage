-- Each product's colour in the admin UI: one of the named product colours in docs/ui.md.
ALTER TABLE products ADD COLUMN colour TEXT;
UPDATE products SET colour = 'gold' WHERE slug = 'cl';
UPDATE products SET colour = 'flame' WHERE slug = 'deaftly';
