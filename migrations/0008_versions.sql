-- Each environment's health endpoint, read for its deployed version (design §8): [{"name":"production"|"beta","healthUrl"}].
ALTER TABLE products ADD COLUMN environments TEXT NOT NULL DEFAULT '[]';
-- Beta ahead of production for longer than this turns the badge amber (design §7).
ALTER TABLE products ADD COLUMN beta_amber_days INTEGER NOT NULL DEFAULT 7;

-- The version each environment last reported, and when that version was first seen.
CREATE TABLE deployed_versions (
  product TEXT NOT NULL REFERENCES products(slug),
  environment TEXT NOT NULL,
  version TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (product, environment)
);
