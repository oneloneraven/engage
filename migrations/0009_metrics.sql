-- Each product's engagement plug-ins (design §8): [{"source","metric","label","primary",...source config}]. Tokens stay in Worker secrets.
ALTER TABLE products ADD COLUMN engagement TEXT NOT NULL DEFAULT '[]';

-- One aggregate per product, metric and UTC day, feeding the sparkline and change. No personal data; kept indefinitely.
CREATE TABLE metric_snapshots (
  product TEXT NOT NULL REFERENCES products(slug),
  metric TEXT NOT NULL,
  day TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value >= 0),
  PRIMARY KEY (product, metric, day)
);
