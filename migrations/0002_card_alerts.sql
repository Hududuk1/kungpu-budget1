CREATE TABLE IF NOT EXISTS card_import_tokens (
  profile TEXT PRIMARY KEY CHECK (profile IN ('꿍', '푸')),
  token_hash TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_alert_events (
  id TEXT PRIMARY KEY,
  profile TEXT NOT NULL CHECK (profile IN ('꿍', '푸')),
  fingerprint TEXT NOT NULL UNIQUE,
  card_company TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('approval', 'cancellation')),
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KRW',
  merchant TEXT NOT NULL,
  category TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  entry_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_alert_events_profile_time
  ON card_alert_events(profile, occurred_at DESC);
