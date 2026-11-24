import { loadConfig } from '../../platform/config/index.js';
import { createWebServer } from '../../platform/httpapi/server.js';
import { Store } from '../../platform/storage/sqlite/index.js';

process.umask(0o077);
try {
  const config = loadConfig('web');
  const store = new Store(config.dbPath);
  const server = createWebServer(config, store);
  server.once('error', (error: NodeJS.ErrnoException) => {
    console.error(JSON.stringify({ level: 'error', event: 'web_listen_failed', code: error.code ?? 'unknown' }));
    store.close();
    process.exitCode = 1;
  });
  server.listen(config.port, '127.0.0.1', () => console.log(JSON.stringify({ level: 'info', event: 'web_listening', url: `http://127.0.0.1:${config.port}` })));
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; server.close(() => store.close()); } };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(JSON.stringify({ level: 'error', event: 'web_startup_failed', message: error instanceof Error ? error.message : '未知错误' }));
  process.exitCode = 1;
}
