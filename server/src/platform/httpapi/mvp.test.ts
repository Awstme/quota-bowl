import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, parseTarget } from '../config/index.js';
import type { Target } from '../config/index.js';
import { Store } from '../storage/sqlite/index.js';
import { createWebServer } from './server.js';

const metrics = [{ key: 'weekly', label: '周使用率', value: 24, unit: '%' }];
const designTarget: Target = { id: 'design-studio', label: '设计工作室', provider: 'opendesign', workspaceId: 'test-studio', intervalSeconds: 300 };

test('旧演示启动命令不会切换到真实采集', () => {
  assert.throws(() => loadConfig('worker', { QUOTA_DEMO: '1' }), /QUOTA_DEMO 已移除/);
});

test('目标校验拒绝未绑定工作区的 OpenDesign', () => {
  const target = { id: 'office', label: '工作间', provider: 'opendesign' };
  assert.throws(() => parseTarget(target, 'target'), /workspaceId/);
  const valid = { ...target, workspaceId: 'ws_1' };
  assert.deepEqual(parseTarget(valid, 'target'), { ...valid, intervalSeconds: 300 });
});

test('共享 SQLite 防止重复采集、拒绝过期提交，并保留最后成功快照', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quota-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'quota.sqlite');
  const targets = [designTarget];
  const a = new Store(file, targets, 0);
  const b = new Store(file, targets, 0);
  try {
    const id = targets[0].id;
    a.enqueue(id, 0);
    const first = a.claim(targets, 0)!;
    b.enqueue(id, 1);
    assert.equal(b.claim(targets, 1), undefined);
    assert.equal(a.finish(first, { metrics }, 2), true);
    assert.equal(b.list(targets)[0].latest?.metrics[0].value, 24);
    b.enqueue(id, 3);
    const dead = b.claim(targets, 3)!;
    const current = a.claim(targets, 120_004)!;
    assert.notEqual(dead.token, current.token);
    assert.equal(b.finish(dead, { metrics }, 120_005), false);
    assert.equal(a.finish(current, { errorCode: 'workspace_mismatch' }, 120_005), true);
    const view = b.list(targets)[0];
    assert.equal(view.status, 'failed');
    assert.equal(view.errorCode, 'workspace_mismatch');
    assert.equal(view.latest?.metrics[0].value, 24);
    assert.equal(b.history(id).length, 1);
    assert.throws(() => new Store(file, [{ ...targets[0], provider: 'opencodego' }]), /身份已变更/);
  } finally { a.close(); b.close(); }
});

test('同一 ID 切换工作区：隔离旧快照，成功后替换，拒绝旧 Worker 写入', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quota-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'quota.sqlite');
  const old = designTarget;
  const next = { ...old, workspaceId: 'another-workspace' };
  const original = new Store(file, [old], 0);
  try {
    original.enqueue(old.id, 1);
    assert.equal(original.finish(original.claim([old], 1)!, { metrics }, 2), true);
    original.enqueue(old.id, 3);
    const stale = original.claim([old], 3)!;
    const switched = new Store(file, [next], 4);
    try {
      assert.equal(switched.list([next])[0].latest, undefined);
      assert.deepEqual(switched.history(next.id), []);
      assert.equal(original.finish(stale, { metrics }, 5), false);
      assert.equal(original.claim([old], 5), undefined);
      assert.equal(switched.finish(switched.claim([next], 5)!, { errorCode: 'workspace_mismatch' }, 6), true);
      assert.deepEqual(switched.history(next.id), []);
      const rolledBack = new Store(file, [old], 7);
      try { assert.equal(rolledBack.history(old.id).length, 1); } finally { rolledBack.close(); }
      const retry = new Store(file, [next], 8);
      try {
        assert.equal(retry.finish(retry.claim([next], 8)!, { metrics: [{ ...metrics[0], value: 55 }] }, 9), true);
        assert.deepEqual(retry.history(next.id).map(s => s.metrics[0].value), [55]);
        assert.equal(original.list([old])[0].latest, undefined);
        const reverted = new Store(file, [old], 10);
        try { assert.deepEqual(reverted.history(old.id), []); } finally { reverted.close(); }
      } finally { retry.close(); }
    } finally { switched.close(); }
  } finally { original.close(); }
});

test('HTTP requires session, same origin and CSRF; exposes only safe target fields', async (t) => {
  const config = loadConfig('web', {});
  const target = { ...designTarget, credentialFile: 'synthetic.cookie' };
  const configuredTargets = [target];
  const dir = await mkdtemp(join(tmpdir(), 'quota-test-'));
  const dbPath = join(dir, 'quota.sqlite');
  const store = new Store(dbPath, configuredTargets);
  const worker = new Store(dbPath, configuredTargets);
  const server = createWebServer(config, store, configuredTargets);
  server.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    worker.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, options?: RequestInit) => fetch(base + path, options);
  assert.equal((await request('/ready')).status, 200);
  assert.equal((await request('/api/targets')).status, 401);
  const login = { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{"username":"admin","password":"admin"}' };
  assert.equal((await request('/api/session', { ...login, headers: { ...login.headers, origin: 'https://other.test' } })).status, 403);
  const response = await request('/api/session', login);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  const { csrfToken } = await response.json();
  const { targets } = await (await request('/api/targets', { headers: { cookie } })).json();
  assert.equal(targets.length, 1);
  assert.equal('credentialFile' in targets[0], false);
  const refresh = '/api/targets/design-studio/refresh';
  assert.equal((await request(refresh, { method: 'POST', headers: { cookie, origin: base } })).status, 403);
  const headers = { cookie, origin: base, 'x-csrf-token': csrfToken };
  assert.equal((await request(refresh, { method: 'POST', headers })).status, 202);
  assert.equal((await request('/api/targets/missing/history', { headers })).status, 404);

  const credentialUrl = '/api/targets/design-studio/credential';
  const synthetic = 'session=' + 'a'.repeat(2048);
  const put = (credential: string, csrf = true) => request(credentialUrl, {
    method: 'PUT',
    headers: { ...(csrf ? headers : { cookie, origin: base }), 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  const inFlight = store.claim([target])!;
  assert.equal(inFlight.credential, null);
  assert.equal((await put(synthetic, false)).status, 403);
  assert.equal((await put('first\nsecond')).status, 400);
  assert.equal((await put(synthetic)).status, 204);
  const targetResponse = await (await request('/api/targets', { headers })).text();
  assert.equal(JSON.parse(targetResponse).targets[0].credentialSource, 'managed');
  assert.equal(targetResponse.includes(synthetic), false);
  assert.equal(targetResponse.includes(target.credentialFile), false);
  assert.equal(store.claim([target]), undefined);
  assert.equal(store.finish(inFlight, { metrics }), false);
  assert.deepEqual(store.history(target.id), []);
  const current = store.claim([target])!;
  assert.equal(current.credential, synthetic);
  assert.equal(current.legacyCiphertext, null);
  assert.equal(store.finish(current, { metrics }), true);
  assert.equal((await request(credentialUrl, { method: 'DELETE', headers })).status, 204);
  assert.equal(store.list([target])[0].credentialSource, 'file');
  assert.equal(store.claim([target])?.credential, null);
  assert.equal(store.history(target.id).length, 1);

  const accounts = [
    { id: 'other-command-001', label: 'Command Test', provider: 'commandcode', credential: 'synthetic-command-key' },
    { id: 'other-design-001', label: 'Design Test', provider: 'opendesign', workspaceId: 'example_ws', credential: 'session=synthetic' },
  ];
  const addAccount = (body: unknown, csrf = true) => request('/api/targets', {
    method: 'POST',
    headers: { ...(csrf ? headers : { cookie, origin: base }), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal((await addAccount(accounts[0], false)).status, 403);
  assert.equal((await addAccount(accounts)).status, 400);
  assert.equal((await addAccount({ ...accounts[0], provider: 'unknown' })).status, 400);
  assert.equal((await addAccount({ ...accounts[1], workspaceId: undefined })).status, 400);
  assert.equal((await addAccount({ ...accounts[1], credential: '' })).status, 400);
  assert.equal(worker.findTarget(accounts[1].id), undefined);
  for (const account of accounts) {
    const created = await addAccount(account);
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { id: account.id });
  }
  assert.equal(worker.findTarget(accounts[1].id)?.workspaceId, 'example_ws');
  assert.equal((await addAccount({ ...accounts[0], credential: 'different-key' })).status, 409);
  const portfolio = await (await request('/api/targets', { headers })).json();
  assert.equal(portfolio.targets.length, 3);
  assert.deepEqual(portfolio.targets.slice(-2).map((item: { credentialSource: string }) => item.credentialSource), ['managed', 'managed']);
  assert.equal(JSON.stringify(portfolio).includes(accounts[0].credential), false);
  const newTargets = worker.targets();
  for (const entry of accounts) {
    const leased = worker.claim(newTargets)!;
    assert.equal(leased.target.id, entry.id);
    assert.equal(leased.credential, entry.credential);
    assert.equal(leased.legacyCiphertext, null);
    assert.equal(worker.finish(leased, { metrics }), true);
    const history = await (await request(`/api/targets/${entry.id}/history`, { headers })).json();
    assert.equal(history.snapshots.length, 1);
  }
  const newId = accounts[0].id;
  assert.equal((await request(`/api/targets/${newId}/credential`, {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'rotated-synthetic' }),
  })).status, 204);
  const reopened = new Store(dbPath, configuredTargets);
  try {
    assert.equal(reopened.targets(configuredTargets).length, 3);
    assert.equal(reopened.history(newId).length, 1);
    const changed = reopened.claim([reopened.findTarget(newId)!])!;
    assert.equal(changed.credential, 'rotated-synthetic');
  } finally { reopened.close(); }

  assert.equal((await request('/api/session', { method: 'DELETE', headers })).status, 204);
  assert.equal((await request('/api/targets', { headers })).status, 401);
});

test('使用数据库中的管理员账号，登录仍要求同源和 CSRF', async (t) => {
  const config = loadConfig('web', {});
  const store = new Store(':memory:');
  const server = createWebServer(config, store);
  server.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
  });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const sessionUrl = base + '/api/session';
  assert.deepEqual(await (await fetch(sessionUrl)).json(), { authenticated: false });
  assert.equal((await fetch(sessionUrl, { method: 'POST', headers: { origin: 'https://other.test' } })).status, 403);
  assert.equal((await fetch(sessionUrl, { method: 'POST' })).status, 403);
  const login = (username: string, password: string) => fetch(sessionUrl, {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  assert.equal((await fetch(sessionUrl, { method: 'POST', headers: { origin: base } })).status, 400);
  assert.equal((await login('wrong', 'admin')).status, 401);
  assert.equal((await login('admin', 'wrong')).status, 401);
  assert.equal((await login('admin', 'admin')).status, 200);
  store.setAdminAccount('a', 'b');
  assert.equal((await login('admin', 'admin')).status, 401);
  const created = await login('a', 'b');
  assert.equal(created.status, 200);
  const cookie = created.headers.get('set-cookie')!.split(';')[0];
  const { authenticated, csrfToken } = await created.json();
  assert.equal(authenticated, true);
  assert.equal(typeof csrfToken, 'string');
  assert.equal((await fetch(base + '/api/targets', { headers: { cookie } })).status, 200);
  const action = base + '/api/targets';
  const headers = { cookie, origin: base, 'content-type': 'application/json' };
  const body = JSON.stringify({ id: 'local-test', label: 'Local Test', provider: 'commandcode', credential: 'synthetic-key' });
  assert.equal((await fetch(action, { method: 'POST', headers, body })).status, 403);
  assert.equal((await fetch(action, { method: 'POST', headers: { ...headers, 'x-csrf-token': csrfToken }, body })).status, 201);
});
