export const initialSchema = `
  CREATE TABLE target_state (
    id TEXT PRIMARY KEY,
    identity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ok', 'failed')),
    error_code TEXT,
    attempted_at INTEGER,
    next_at INTEGER NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT,
    lease_until INTEGER
  ) STRICT;
  CREATE TABLE snapshot (
    id INTEGER PRIMARY KEY,
    target_id TEXT NOT NULL REFERENCES target_state(id),
    collected_at INTEGER NOT NULL,
    metrics TEXT NOT NULL
  ) STRICT;
  CREATE INDEX snapshot_target ON snapshot(target_id, id DESC);
  PRAGMA user_version = 1;
`;
