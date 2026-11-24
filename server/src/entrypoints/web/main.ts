import { loadConfig } from '../../platform/config/index.js';
import type { Config } from '../../platform/config/index.js';
import { createWebServer } from '../../platform/httpapi/server.js';
import { Store } from '../../platform/storage/sqlite/index.js';

export async function runWeb(config: Config, store: Store, signal: AbortSignal) {
  const server = createWebServer(config, store);
  await new Promise<void>((resolve, reject) => {
    server.once('close', resolve);
    server.once('error', reject);
    server.listen({ port: config.port, host: config.bindHost, signal }, () => {
      console.log(JSON.stringify({ level: 'info', event: 'web_listening', url: `http://${config.bindHost}:${config.port}` }));
    });
  });
}

if (import.meta.main) {
  process.umask(0o077);
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  process.once('SIGTERM', () => stop.abort());
  try {
    const config = loadConfig('web');
    const store = new Store(config.dbPath);
    try {
      await runWeb(config, store, stop.signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
      console.error(JSON.stringify({ level: 'error', event: 'web_listen_failed', code }));
      process.exitCode = 1;
    } finally { store.close(); }
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'web_startup_failed', message: error instanceof Error ? error.message : '未知错误' }));
    process.exitCode = 1;
  }
}
