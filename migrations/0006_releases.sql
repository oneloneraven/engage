-- Repositories whose deploys wait for the owner's approval in Engage, and the releases waiting or decided.
CREATE TABLE release_repos (
  repo TEXT PRIMARY KEY, product TEXT NOT NULL REFERENCES products(slug),
  environments TEXT NOT NULL,                                                -- JSON array
  token_policy TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE releases (
  id TEXT PRIMARY KEY, repo TEXT NOT NULL, product TEXT NOT NULL REFERENCES products(slug),
  environment TEXT NOT NULL, sha TEXT NOT NULL, ref TEXT, run_id INTEGER NOT NULL,
  callback_url TEXT NOT NULL, installation_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','expired','spent')),
  note TEXT, created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, spent_at TEXT
);
-- Only pending releases are de-duplicated, so a re-run of a rejected or deployed job asks again.
CREATE UNIQUE INDEX releases_pending ON releases (run_id, environment) WHERE state = 'pending';
CREATE INDEX releases_state ON releases (state, created_at);
INSERT INTO release_repos (repo, product, environments) VALUES
  ('oneloneraven/climbing-logbook', 'cl', '["production","infra"]'),
  ('oneloneraven/deaftly-website', 'deaftly', '["production","infra"]'),
  ('oneloneraven/deaftly', 'deaftly', '["release"]');
