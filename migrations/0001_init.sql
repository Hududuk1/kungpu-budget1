CREATE TABLE IF NOT EXISTS household_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  shared_salt TEXT NOT NULL,
  shared_hash TEXT NOT NULL,
  kung_salt TEXT,
  kung_hash TEXT,
  pu_salt TEXT,
  pu_hash TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL CHECK (owner IN ('꿍', '푸')),
  type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  spent_on TEXT NOT NULL,
  category TEXT NOT NULL,
  payment TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  receipt_path TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_owner_date ON entries(owner, spent_on DESC);

CREATE TABLE IF NOT EXISTS profile_settings (
  profile TEXT PRIMARY KEY CHECK (profile IN ('꿍', '푸')),
  budget_krw REAL NOT NULL DEFAULT 0,
  budget_usd REAL NOT NULL DEFAULT 0,
  accounts TEXT NOT NULL DEFAULT '[]',
  recurring TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL CHECK (owner IN ('꿍', '푸')),
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
