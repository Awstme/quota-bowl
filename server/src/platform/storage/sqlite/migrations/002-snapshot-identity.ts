export const snapshotIdentityMigration = `
  ALTER TABLE target_state ADD COLUMN snapshot_identity TEXT;
  PRAGMA user_version = 2;
`;
