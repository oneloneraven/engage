CREATE TABLE products (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, domains TEXT NOT NULL,           -- JSON array
  issue_repo TEXT NOT NULL, site_repo TEXT, site_dispatch_event TEXT,
  discord_secret TEXT NOT NULL, email_domain TEXT NOT NULL, email_aliases TEXT NOT NULL DEFAULT '["hello"]',
  retention_months INTEGER NOT NULL DEFAULT 12, app_daily_cap INTEGER NOT NULL DEFAULT 50,
  context_schema TEXT NOT NULL DEFAULT '{}', backup_forward_to TEXT,
  testimonials_enabled INTEGER NOT NULL DEFAULT 1, account_secret TEXT NOT NULL, thanks_url TEXT NOT NULL
);
CREATE TABLE items (
  id TEXT PRIMARY KEY, product TEXT NOT NULL REFERENCES products(slug),
  kind TEXT NOT NULL CHECK (kind IN ('issue','feedback','email')),
  source TEXT NOT NULL CHECK (source IN ('web','app','email')),
  subject TEXT, contact_email TEXT, contact_name TEXT,
  quote_consent INTEGER NOT NULL DEFAULT 0, credit TEXT CHECK (credit IN ('name','initials','anonymous')),
  source_page TEXT, section TEXT, app_version TEXT, context TEXT, account_ref TEXT, auth_result TEXT,
  junk INTEGER NOT NULL DEFAULT 0, suspected_spam INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0,
  read_at TEXT, archived_at TEXT, reply_owed_at TEXT, issue_number INTEGER, issue_url TEXT,
  created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')), from_addr TEXT,
  body_text TEXT NOT NULL, body_html TEXT, rfc_message_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL, filename TEXT, content_type TEXT, size INTEGER NOT NULL
);
CREATE TABLE testimonials (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  product TEXT NOT NULL, excerpt TEXT NOT NULL, attribution TEXT NOT NULL,
  approved_at TEXT, withdrawn_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE blocklist (pattern TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT
);
CREATE INDEX items_inbox ON items (product, junk, archived_at, read_at, last_activity_at);
CREATE INDEX items_issue ON items (issue_number);
