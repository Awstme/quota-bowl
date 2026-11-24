export const plaintextCredentialsMigration = `
  ALTER TABLE target_state ADD COLUMN credential_plaintext TEXT;
  PRAGMA user_version = 5;
`;
