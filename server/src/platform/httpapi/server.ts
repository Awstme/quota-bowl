import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { matchesPassword } from '../../modules/auth/password.js';
import { maxCredentialBytes, normalizeCredential } from '../../modules/collection/credentials.js';
import { Sessions } from '../../modules/auth/session.js';
import { parseTarget } from '../config/index.js';
import type { Config, Target } from '../config/index.js';
import type { Store } from '../storage/sqlite/index.js';

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value));
};
const empty = (res: ServerResponse, status: number) => res.writeHead(status).end();
const missing = () => new HttpError(404, 'not_found', '找不到此项目。');
const badLogin = () => new HttpError(400, 'invalid_body', '请输入用户名和密码。');
const targetChanged = () => new HttpError(409, 'target_changed', '采集目标已变更，请重新加载页面。');
const badCredential = () => new HttpError(400, 'invalid_credential', '请输入有效的单行密钥，最多 64 KiB。');

async function readJson(req: IncomingMessage, limit: number, badBody: () => HttpError): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw badBody();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) { req.resume(); throw new HttpError(413, 'body_too_large', '请求内容过大。'); }
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw badBody(); }
}

async function readLogin(req: IncomingMessage) {
  const data = await readJson(req, 4096, badLogin);
  if (!data || typeof data !== 'object' || !('username' in data) || !('password' in data)) throw badLogin();
  const { username, password } = data;
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) throw badLogin();
  return { username, password };
}

function credentialFrom(data: unknown) {
  const value = data && typeof data === 'object' && 'credential' in data && typeof data.credential === 'string'
    ? normalizeCredential(data.credential) : undefined;
  if (value === undefined) throw badCredential();
  return value;
}

async function readCredential(req: IncomingMessage) {
  return credentialFrom(await readJson(req, maxCredentialBytes * 6 + 1024, badCredential));
}

const invalidTarget = () => new HttpError(400, 'invalid_target', '请填写有效的渠道、账号名称和工作区 ID。');

export function createWebServer(config: Config, store: Store, configuredTargets: readonly Target[] = []) {
  const sessions = new Sessions((username, password) => {
    const account = store.adminAccount();
    return matchesPassword(password, account.password_salt, account.password_hash) && username === account.username;
  });
  const targetById = new Map(configuredTargets.map(target => [target.id, target]));
  const findTarget = (id: string) => targetById.get(id) ?? store.findTarget(id);
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000 }, async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    try {
      const port = req.socket.localPort;
      const host = req.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && !(port === 80 && (host === '127.0.0.1' || host === 'localhost'))) {
        throw new HttpError(403, 'host_not_allowed', '仅允许本机访问。');
      }
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw missing();
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      const method = req.method;
      if (method === 'GET' && (path === '/health' || path === '/ready')) {
        if (path === '/ready') store.check();
        return json(res, 200, { status: 'ok' });
      }
      if (!path.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw missing();
        const asset = /^\/assets\/([\w.-]+\.(?:js|css|svg|woff2))$/.exec(path);
        const file = path === '/' ? 'index.html' : asset ? `assets/${asset[1]}` : undefined;
        if (!file) throw missing();
        const data = await readFile(join(config.webDir, file)).catch(() => { throw missing(); });
        const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
          : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2';
        return res.writeHead(200, { 'Content-Type': type }).end(method === 'HEAD' ? undefined : data);
      }
      if (method !== 'GET' && req.headers.origin !== `http://${host}`) throw new HttpError(403, 'origin_not_allowed', '请求来源不受信任。');
      const session = sessions.get(req.headers.cookie);
      if (path === '/api/session') {
        if (method === 'GET') return json(res, 200, { authenticated: !!session, csrfToken: session?.csrfToken });
        if (method === 'POST') {
          const { username, password } = await readLogin(req);
          const reply = sessions.login(username, password, req.headers.cookie);
          if (reply.status === 429) throw new HttpError(429, 'login_rate_limited', '尝试过多，请稍后重试。');
          if (reply.status === 401) throw new HttpError(401, 'invalid_credentials', '用户名或密码不正确。');
          res.setHeader('Set-Cookie', reply.cookie);
          return json(res, 200, { authenticated: true, csrfToken: reply.csrfToken });
        }
      }
      if (!session) throw new HttpError(401, 'unauthenticated', '请先登录。');
      if (method !== 'GET' && req.headers['x-csrf-token'] !== session.csrfToken) throw new HttpError(403, 'csrf_invalid', '会话校验失败，请重新登录。');
      if (path === '/api/session' && method === 'DELETE') {
        res.setHeader('Set-Cookie', sessions.logout(req.headers.cookie));
        return empty(res, 204);
      }
      if (path === '/api/targets' && method === 'GET') return json(res, 200, { targets: store.list(store.targets(configuredTargets)), credentialManagement: true });
      if (path === '/api/targets' && method === 'POST') {
        const data = await readJson(req, maxCredentialBytes * 6 + 4096, invalidTarget);
        let target;
        try { target = parseTarget(data, 'target'); } catch { throw invalidTarget(); }
        if (!store.addTarget(target, credentialFrom(data))) {
          throw new HttpError(409, 'target_exists', '此账号 ID 已被使用，请刷新账号列表。');
        }
        return json(res, 201, { id: target.id });
      }
      const route = /^\/api\/targets\/([a-z0-9-]+)\/(history|refresh|credential)$/.exec(path);
      const target = route && findTarget(route[1]);
      if (!route || !target) throw missing();
      if (route[2] === 'credential' && (method === 'PUT' || method === 'DELETE')) {
        const credential = method === 'PUT' ? await readCredential(req) : null;
        if (!store.setCredential(target.id, credential)) throw targetChanged();
        return empty(res, 204);
      }
      if (route[2] === 'history' && method === 'GET') return json(res, 200, { snapshots: store.history(route[1]) });
      if (route[2] === 'refresh' && method === 'POST') { store.enqueue(route[1]); return empty(res, 202); }
      throw missing();
    } catch (error) {
      if (error instanceof HttpError) return json(res, error.status, { error: { code: error.code, message: error.message } });
      console.error(JSON.stringify({ level: 'error', event: 'http_error', requestId }));
      return json(res, 500, { error: { code: 'internal_error', message: '请求未完成，请稍后重试。' } });
    }
  });
  return server;
}
