-- Each monitor's own state behind a product's health, for its Health page: [{"name","url","status"}].
ALTER TABLE health_state ADD COLUMN monitors TEXT NOT NULL DEFAULT '[]';
