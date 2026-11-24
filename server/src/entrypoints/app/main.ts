import { loadConfig } from '../../platform/config/index.js';
import { Store } from '../../platform/storage/sqlite/index.js';
import { runWeb } from '../web/main.js';
import { runWorker } from '../worker/main.js';

process.umask(0o077);
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

try {
  const config = loadConfig('app');
  const store = new Store(config.dbPath);
  const services = [runWeb(config, store, stop.signal), runWorker(config, store, stop.signal)];
  try {
    await Promise.all(services);
  } finally {
    stop.abort();
    await Promise.allSettled(services);
    store.close();
  }
} catch (error) {
  console.error(JSON.stringify({ level: 'error', event: 'app_failed', message: error instanceof Error ? error.message : '未知错误' }));
  process.exitCode = 1;
}
