import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../../../modules/auth/password.js';
import type { Metric } from '../../../modules/collection/providers/codexbar.js';
import type { Target } from '../../config/index.js';
import { initialSchema } from './migrations/001-initial.js';
import { snapshotIdentityMigration } from './migrations/002-snapshot-identity.js';
import { targetCredentialsMigration } from './migrations/003-target-credentials.js';
import { importedTargetsMigration } from './migrations/004-imported-targets.js';
import { plaintextCredentialsMigration } from './migrations/005-plaintext-credentials.js';
import { adminAccountMigration } from './migrations/006-admin-account.js';

type AdminAccount = { username: string; password_salt: Uint8Array; password_hash: Uint8Array };
type State = { status: 'pending' | 'ok' | 'failed'; error_code: string | null; attempted_at: number | null;
  collected_at: number | null; metrics: string | null; managed_credential: number };
type SnapshotRow = { collected_at: number; metrics: string };
export type Lease = { target: Target; token: string; credential: string | null; legacyCiphertext: string | null; credentialRevision: number };
type ImportedTarget = Omit<Target, 'credentialFile'>;
type ImportedTargetRow = {
  id: string; label: string; provider: Target['provider']; workspace_id: string | null; interval_seconds: number;
};
function importedTarget(row: ImportedTargetRow): ImportedTarget {
  return { id: row.id, label: row.label, provider: row.provider, workspaceId: row.workspace_id ?? undefined, intervalSeconds: row.interval_seconds };
}
type Result = { metrics: Metric[] } | { errorCode: string };
const iso = (ms: number) => new Date(ms).toISOString();
const snapshot = (row: SnapshotRow) => ({ collectedAt: iso(row.collected_at), metrics: JSON.parse(row.metrics) as Metric[] });

export class Store {
  readonly #db: DatabaseSync;
  readonly #identities = new Map<string, string>();

  constructor(path: string, targets: readonly Target[] = [], now = Date.now()) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path, { timeout: 5000 });
    try {
      this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON');
      this.#transaction(() => {
        const version = this.#db.prepare('PRAGMA user_version').get()?.user_version;
        if (version === 0) this.#db.exec(initialSchema);
        if (version === 0 || version === 1) this.#db.exec(snapshotIdentityMigration);
        if (version === 0 || version === 1 || version === 2) this.#db.exec(targetCredentialsMigration);
        if (version === 0 || version === 1 || version === 2 || version === 3) this.#db.exec(importedTargetsMigration);
        if (version === 0 || version === 1 || version === 2 || version === 3 || version === 4) this.#db.exec(plaintextCredentialsMigration);
        if (typeof version !== 'number' || version < 0 || version > 6) throw new Error('不支持的 SQLite 架构版本');
        if (version < 6) {
          this.#db.exec(adminAccountMigration);
          this.setAdminAccount('admin', 'admin');
        }
        const register = this.#db.prepare('INSERT INTO target_state (id, identity, next_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING');
        const read = this.#db.prepare('SELECT identity FROM target_state WHERE id = ?');
        const imported = this.#db.prepare('SELECT 1 FROM imported_target WHERE id = ?');
        const switchWorkspace = this.#db.prepare(`UPDATE target_state SET snapshot_identity = coalesce(snapshot_identity, identity),
          identity = ?, status = 'pending', error_code = NULL, attempted_at = NULL, failures = 0, next_at = ?,
          lease_token = NULL, lease_until = NULL, credential_ciphertext = NULL, credential_plaintext = NULL, credential_revision = credential_revision + 1 WHERE id = ?`);
        for (const target of targets) {
          // For providers without a workspace ID, the operator must keep the ID attached to the same account.
          if (imported.get(target.id)) throw new Error(`目标 ${target.id} 已由面板创建，请从目标文件中移除同名配置`);
          const identity = this.#targetIdentity(target);
          const jitter = createHash('sha256').update(target.id).digest().readUInt32BE(0) % 30_000;
          register.run(target.id, identity, now + jitter);
          const previous = read.get(target.id)?.identity;
          if (previous !== identity) {
            const [wasDemo, wasProvider] = typeof previous === 'string' ? JSON.parse(previous) : [];
            if (wasDemo !== false || wasProvider !== 'opendesign' || target.provider !== 'opendesign') {
              throw new Error(`目标 ${target.id} 的身份已变更，请使用新的目标 ID`);
            }
            switchWorkspace.run(identity, now, target.id);
          }
          this.#identities.set(target.id, identity);
        }
      });
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  #transaction<T>(work: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const value = work(); this.#db.exec('COMMIT'); return value; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }

  check() { this.#db.prepare('SELECT 1 FROM target_state LIMIT 1').get(); }

  close() { this.#db.close(); }

  adminAccount() {
    return this.#db.prepare('SELECT username, password_salt, password_hash FROM admin_account WHERE id = 1').get() as AdminAccount;
  }

  setAdminAccount(username: string, password: string) {
    if (!username || !password) throw new Error('用户名和密码不能为空');
    const { salt, hash } = hashPassword(password);
    this.#db.prepare(`INSERT INTO admin_account (id, username, password_salt, password_hash)
      VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      username = excluded.username, password_salt = excluded.password_salt, password_hash = excluded.password_hash`).run(username, salt, hash);
  }

  #targetIdentity(target: Target) {
    // Keep the persisted identity of existing real targets.
    return JSON.stringify([false, target.provider, target.workspaceId ?? null]);
  }

  #identity(id: string) {
    return this.#identities.get(id) ?? this.#db.prepare(`SELECT t.identity FROM imported_target i
      JOIN target_state t ON t.id = i.id WHERE i.id = ? AND i.demo = 0`).get(id)?.identity ?? null;
  }

  targets(configured: readonly Target[] = []): Target[] {
    const rows = this.#db.prepare(`SELECT id, label, provider, workspace_id, interval_seconds
      FROM imported_target WHERE demo = 0 ORDER BY id`).all() as ImportedTargetRow[];
    return [...configured, ...rows.map(importedTarget)];
  }

  findTarget(id: string): ImportedTarget | undefined {
    const row = this.#db.prepare(`SELECT id, label, provider, workspace_id, interval_seconds
      FROM imported_target WHERE id = ? AND demo = 0`).get(id) as ImportedTargetRow | undefined;
    return row && importedTarget(row);
  }

  addTarget(target: ImportedTarget, credential: string, now = Date.now()) {
    return this.#transaction(() => {
      const registered = this.#db.prepare(`INSERT INTO target_state (id, identity, next_at, credential_plaintext)
        VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).run(target.id, this.#targetIdentity(target), now, credential);
      if (registered.changes !== 1) return false;
      this.#db.prepare(`INSERT INTO imported_target (id, label, provider, workspace_id, interval_seconds, demo)
        VALUES (?, ?, ?, ?, ?, 0)`).run(target.id, target.label, target.provider, target.workspaceId ?? null, target.intervalSeconds);
      return true;
    });
  }

  list(targets: readonly Target[]) {
    const state = this.#db.prepare(`SELECT t.status, t.error_code, t.attempted_at, s.collected_at, s.metrics, coalesce(t.credential_plaintext, t.credential_ciphertext) IS NOT NULL AS managed_credential
      FROM target_state t LEFT JOIN snapshot s ON s.id = (
        SELECT id FROM snapshot WHERE target_id = t.id ORDER BY id DESC LIMIT 1
      ) AND coalesce(t.snapshot_identity, t.identity) = t.identity WHERE t.id = ? AND t.identity = ?`);
    return targets.map(target => {
      const { id, provider, label, workspaceId, intervalSeconds, credentialFile } = target;
      const row = state.get(id, this.#targetIdentity(target)) as State | undefined;
      const fields = { id, provider, label, workspaceId, intervalSeconds, credentialFileConfigured: !!credentialFile,
        credentialSource: row?.managed_credential ? 'managed' : credentialFile ? 'file' : 'unconfigured' } as const;
      if (!row) return { ...fields, status: 'pending' as const };
      return { ...fields, status: row.status,
        errorCode: row.error_code ?? undefined, lastAttemptAt: row.attempted_at === null ? undefined : iso(row.attempted_at),
        latest: row.collected_at === null || row.metrics === null ? undefined : snapshot({ collected_at: row.collected_at, metrics: row.metrics }) };
    });
  }

  history(id: string, limit = 100) {
    return (this.#db.prepare(`SELECT s.collected_at, s.metrics FROM snapshot s JOIN target_state t ON t.id = s.target_id
      WHERE t.id = ? AND t.identity = ? AND coalesce(t.snapshot_identity, t.identity) = t.identity ORDER BY s.id DESC LIMIT ?`)
      .all(id, this.#identity(id), limit) as SnapshotRow[]).map(snapshot);
  }

  enqueue(id: string, now = Date.now()) {
    this.#db.prepare(`UPDATE target_state SET next_at = min(next_at, ?) WHERE id = ? AND identity = ?
      AND (lease_until IS NULL OR lease_until <= ?)`).run(now, id, this.#identity(id), now);
  }

  setCredential(id: string, credential: string | null, now = Date.now()) {
    const result = this.#db.prepare(`UPDATE target_state SET credential_plaintext = ?, credential_ciphertext = NULL,
      credential_revision = credential_revision + 1, next_at = ?, failures = 0
      WHERE id = ? AND identity = ?`).run(credential, now, id, this.#identity(id));
    return result.changes === 1;
  }

  claim(targets: readonly Target[], now = Date.now()): Lease | undefined {
    if (!targets.length) return;
    const byId = new Map(targets.map(target => [target.id, target]));
    return this.#transaction(() => {
      const identities = JSON.stringify(Object.fromEntries(targets.map(target => [target.id, this.#targetIdentity(target)])));
      const row = this.#db.prepare(`SELECT t.id, t.credential_plaintext, t.credential_ciphertext, t.credential_revision FROM target_state t JOIN json_each(?) configured
        ON t.id = configured.key AND t.identity = configured.value
        WHERE t.next_at <= ? AND (t.lease_until IS NULL OR t.lease_until <= ?) ORDER BY t.next_at, t.id LIMIT 1`).get(identities, now, now);
      if (!row) return;
      const target = byId.get(row.id as string)!;
      const token = randomUUID();
      this.#db.prepare('UPDATE target_state SET lease_token = ?, lease_until = ? WHERE id = ?').run(token, now + 120_000, target.id);
      return { target, token, credential: row.credential_plaintext as string | null,
        legacyCiphertext: row.credential_ciphertext as string | null, credentialRevision: Number(row.credential_revision) };
    });
  }

  convertLegacyCredential(lease: Lease, credential: string) {
    const result = this.#db.prepare(`UPDATE target_state SET credential_plaintext = ?, credential_ciphertext = NULL
      WHERE id = ? AND lease_token = ? AND credential_revision = ? AND credential_ciphertext = ?
        AND credential_plaintext IS NULL`).run(credential, lease.target.id, lease.token, lease.credentialRevision, lease.legacyCiphertext);
    return result.changes === 1;
  }

  finish({ target, token, credentialRevision }: Lease, result: Result, now = Date.now()) {
    return this.#transaction(() => {
      const row = this.#db.prepare('SELECT failures, credential_revision FROM target_state WHERE id = ? AND lease_token = ? AND lease_until > ?').get(target.id, token, now);
      if (!row) return false;
      if (row.credential_revision !== credentialRevision) {
        // Let a running collection finish, then collect again with the new credential.
        this.#db.prepare('UPDATE target_state SET lease_token = NULL, lease_until = NULL WHERE id = ?').run(target.id);
        return false;
      }
      const failed = 'errorCode' in result;
      const interval = target.intervalSeconds * 1000;
      const failures = failed ? Math.min(Number(row.failures) + 1, 5) : 0;
      const backoff = failed ? Math.min(Math.max(30 * 60_000, interval), interval * 2 ** (failures - 1)) : interval;
      this.#db.prepare(`UPDATE target_state SET status = ?, error_code = ?, attempted_at = ?, next_at = ?, failures = ?,
        lease_token = NULL, lease_until = NULL WHERE id = ?`).run(failed ? 'failed' : 'ok', failed ? result.errorCode : null, now, now + backoff, failures, target.id);
      if (!failed) {
        // Only a successful collection supersedes history from the previous workspace.
        this.#db.prepare(`DELETE FROM snapshot WHERE target_id = ? AND EXISTS (
          SELECT 1 FROM target_state WHERE id = ? AND snapshot_identity <> identity)`).run(target.id, target.id);
        this.#db.prepare('UPDATE target_state SET snapshot_identity = NULL WHERE id = ?').run(target.id);
        this.#db.prepare('INSERT INTO snapshot(target_id,collected_at,metrics) VALUES(?,?,?)').run(target.id, now, JSON.stringify(result.metrics));
      }
      return true;
    });
  }
}
