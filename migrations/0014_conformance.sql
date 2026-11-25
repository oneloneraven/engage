-- Conformance (Module 4): each repository's result for each of bootstrap's checks, the checks themselves as last read,
-- and each daily run. Repository names and settings only; no personal data.
CREATE TABLE conformance_results (
  repo TEXT NOT NULL,
  check_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass','fail','unknown','skipped','n/a')),
  reason TEXT NOT NULL DEFAULT '',
  link TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (repo, check_id)
);
CREATE TABLE conformance_checks (id TEXT PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE conformance_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  rules_version INTEGER,
  complete INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
