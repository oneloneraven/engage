-- Where each product's health comes from (design §8): {"betterStack":{"monitors":[{"id","name","url"}]}}. Tokens stay in Worker secrets.
ALTER TABLE products ADD COLUMN health_sources TEXT NOT NULL DEFAULT '{}';

-- The latest health per product, written every five minutes so Home never waits on Better Stack.
CREATE TABLE health_state (
  product TEXT PRIMARY KEY REFERENCES products(slug),
  status TEXT NOT NULL CHECK (status IN ('healthy','degraded','failing','unmonitored','unknown')),
  reason TEXT,
  link TEXT,
  checked_at TEXT NOT NULL
);
