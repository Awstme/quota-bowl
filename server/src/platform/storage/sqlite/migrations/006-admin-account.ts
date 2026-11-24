export const adminAccountMigration = `
  CREATE TABLE admin_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL CHECK (length(username) > 0),
    password_salt BLOB NOT NULL CHECK (length(password_salt) = 16),
    password_hash BLOB NOT NULL CHECK (length(password_hash) = 64)
  ) STRICT;
  PRAGMA user_version = 6;
`;
