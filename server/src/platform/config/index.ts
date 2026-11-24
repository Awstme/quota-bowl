import { resolve } from 'node:path';
import type { CollectorTarget, Provider } from '../../modules/collection/providers/codexbar.js';

export type Target = CollectorTarget & { id: string; label: string; intervalSeconds: number };
export type Config = ReturnType<typeof loadConfig>;

const providers: readonly string[] = ['opendesign', 'opencodego', 'commandcode'];

function invalid(field: string): never { throw new Error(`配置无效：${field}`); }

export function parseTarget(row: unknown, field: string): Omit<Target, 'credentialFile'> {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return invalid(field);
  const { id, label, provider, workspaceId, intervalSeconds = 300 } = row as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return invalid(`${field}.id`);
  if (typeof label !== 'string' || !label.trim() || label.length > 100) return invalid(`${field}.label`);
  if (typeof provider !== 'string' || !providers.includes(provider)) return invalid(`${field}.provider`);
  if (provider === 'opendesign' && (typeof workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId))) return invalid(`${field}.workspaceId`);
  if (typeof intervalSeconds !== 'number' || !Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 86400) return invalid(`${field}.intervalSeconds`);
  return { id, label: label.trim(), provider: provider as Provider, intervalSeconds,
    ...(provider === 'opendesign' && typeof workspaceId === 'string' ? { workspaceId } : {}) };
}

export function loadConfig(role: 'app' | 'web' | 'worker', env = process.env) {
  if (env.QUOTA_DEMO === '1') throw new Error('QUOTA_DEMO 已移除，请更新启动命令。');
  const port = Number(env.QUOTA_PORT ?? '5555');
  if (!Number.isInteger(port) || port < 1 || port > 65535) return invalid('QUOTA_PORT');
  const bindHost = env.QUOTA_BIND_HOST ?? '127.0.0.1';
  if (role !== 'worker' && bindHost !== '127.0.0.1' && bindHost !== '0.0.0.0') return invalid('QUOTA_BIND_HOST');
  const legacyPrivateKeyFile = role === 'web' ? undefined : env.QUOTA_CREDENTIAL_PRIVATE_KEY_FILE;
  return { port, bindHost, legacyPrivateKeyFile, dbPath: resolve(env.QUOTA_DB ?? 'quota-bowl/quota.sqlite'),
    binary: env.QUOTA_CODEXBAR ?? 'codexbar', webDir: resolve(env.QUOTA_WEB_DIR ?? 'web/dist') };
}
