export const targetCredentialsMigration = `
  ALTER TABLE target_state ADD COLUMN credential_ciphertext TEXT;
  ALTER TABLE target_state ADD COLUMN credential_revision INTEGER NOT NULL DEFAULT 0;
  PRAGMA user_version = 3;
`;
