CREATE TABLE IF NOT EXISTS portals (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  property_title TEXT NOT NULL DEFAULT '',
  client_label TEXT NOT NULL DEFAULT '',
  property_address TEXT NOT NULL DEFAULT '',
  delivered_at TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  access_code_hash TEXT NOT NULL,
  direct_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_files (
  id TEXT PRIMARY KEY,
  portal_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  alt TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (portal_id) REFERENCES portals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portals_slug ON portals(slug);
CREATE INDEX IF NOT EXISTS idx_portal_files_portal_order ON portal_files(portal_id, order_index, created_at);
