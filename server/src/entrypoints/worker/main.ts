import { openLegacyCredential, readLegacyPrivateKey } from '../../modules/collection/credentials.js';
import { setTimeout as delay } from 'node:timers/promises';
import { collect, CollectionError } from '../../modules/collection/providers/codexbar.js';
import { loadConfig } from '../../platform/config/index.js';
import { Store } from '../../platform/storage/sqlite/index.js';

process.umask(0o077);
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
try {
  const config = loadConfig('worker');
  const store = new Store(config.dbPath);
  console.log(JSON.stringify({ level: 'info', event: 'worker_started' }));
  try {
    while (!stop.signal.aborted) {
      const lease = store.claim(store.targets());
      if (!lease) {
        try { await delay(1000, undefined, { signal: stop.signal }); } catch (error) { if (!stop.signal.aborted) throw error; }
        continue;
      }
      const started = Date.now();
      const result = await (async () => {
        try {
          let credential = lease.credential;
          if (credential === null && lease.legacyCiphertext !== null) {
            const key = readLegacyPrivateKey(config.legacyPrivateKeyFile);
            credential = openLegacyCredential(lease.legacyCiphertext, key, lease.target) ?? null;
            if (credential === null) throw new CollectionError('credential_decryption_failed');
            store.convertLegacyCredential(lease, credential);
          }
          return { metrics: await collect(lease.target, config.binary, credential ?? undefined) };
        } catch (error) {
          return { errorCode: error instanceof CollectionError ? error.code : 'collection_failed' };
        }
      })();
      const saved = store.finish(lease, result);
      console.log(JSON.stringify({ level: saved && !result.errorCode ? 'info' : 'warn', event: 'collection_finished', targetId: lease.target.id,
        durationMs: Date.now() - started, saved, errorCode: result.errorCode }));
    }
  } finally { store.close(); }
} catch {
  console.error(JSON.stringify({ level: 'error', event: 'worker_failed', message: '请检查采集配置和 SQLite 文件权限。' }));
  process.exitCode = 1;
}
