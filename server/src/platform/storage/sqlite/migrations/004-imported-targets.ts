export const importedTargetsMigration = `
  CREATE TABLE imported_target (
    id TEXT PRIMARY KEY REFERENCES target_state(id),
    label TEXT NOT NULL,
    provider TEXT NOT NULL,
    workspace_id TEXT,
    interval_seconds INTEGER NOT NULL,
    demo INTEGER NOT NULL CHECK (demo IN (0, 1))
  ) STRICT;
  PRAGMA user_version = 4;
`;
