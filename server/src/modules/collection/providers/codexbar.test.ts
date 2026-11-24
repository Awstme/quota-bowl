import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { CollectionError, collect, parseCodexbarUsage, type Provider } from './codexbar.js';

const design = { provider: 'opendesign', workspaceId: 'workspace-A' } as const;
const go = { provider: 'opencodego' } as const;
const command = { provider: 'commandcode' } as const;
const reset = '2027-01-02T03:04:05Z';
const secret = 'synthetic-not-a-real-secret';
const window = (windowMinutes: number, usedPercent: number, extra = {}) => ({ windowMinutes, usedPercent, ...extra });
const row = (provider: Provider, usage: Record<string, unknown>, extra = {}) => ({
  provider, source: provider === 'opendesign' ? 'web' : 'api', usage, ...extra,
});
const payload = (provider: Provider, usage: Record<string, unknown>, extra = {}) => JSON.stringify([row(provider, usage, extra)]);

function hasCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof CollectionError);
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(String(error.stack), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(error), new RegExp(secret));
    return true;
  };
}

test('normalizes OpenDesign’s measured windows for the verified workspace', () => {
  const actual = parseCodexbarUsage(payload('opendesign', {
    primary: window(300, 12.5, { resetsAt: reset, quotaLimit: 400, quotaUnit: 'credits', title: secret }),
    secondary: window(10080, 0),
    identity: { providerID: 'opendesign', accountID: 'workspace-A', accountOrganization: secret },
  }), design);
  assert.deepEqual(actual, [
    { key: '5h_used_percent', label: '5-hour usage', value: 12.5, unit: '%', resetsAt: '2027-01-02T03:04:05.000Z' },
    { key: 'weekly_used_percent', label: 'Weekly usage', value: 0, unit: '%' },
  ]);
});

test('OpenDesign workspace verification never trusts display metadata or another provider', () => {
  const primary = window(300, 10);
  assert.throws(() => parseCodexbarUsage('[]', { provider: 'opendesign' }), hasCode('workspace_required'));
  assert.throws(() => parseCodexbarUsage('[]', { ...design, workspaceId: `${secret}/` }), hasCode('workspace_required'));
  for (const identity of [
    undefined,
    { providerID: 'opendesign', accountOrganization: 'workspace-A' },
    { providerID: 'commandcode', accountID: 'workspace-A' },
    { providerID: 'opendesign', accountID: `workspace-A\n` },
  ]) {
    assert.throws(() => parseCodexbarUsage(payload('opendesign', { primary, identity }, { account: 'workspace-A' }), design),
      hasCode('workspace_unverified'));
  }
  assert.throws(() => parseCodexbarUsage(payload('opendesign', {
    primary, identity: { providerID: 'opendesign', accountID: secret, accountOrganization: 'workspace-A' },
  }), design), hasCode('workspace_mismatch'));
});

test('Go and Command Code use the same measured window units, with absent windows omitted', () => {
  assert.deepEqual(parseCodexbarUsage(payload('opencodego', {
    primary: window(300, 9), tertiary: window(43200, 1, { resetsAt: reset }),
    extraRateWindows: [{ id: 'renewal', title: 'Renews', window: { usedPercent: 0, resetsAt: reset } }],
    providerCost: { currencyCode: 'USD', remaining: 5 },
  }), go), [
    { key: '5h_used_percent', label: '5-hour usage', value: 9, unit: '%' },
    { key: 'monthly_used_percent', label: 'Monthly usage', value: 1, unit: '%', resetsAt: '2027-01-02T03:04:05.000Z' },
  ]);
  assert.deepEqual(parseCodexbarUsage(payload('commandcode', {
    secondary: window(10080, 42), identity: { loginMethod: '$3.25 plan credits' },
  }), command), [{ key: 'weekly_used_percent', label: 'Weekly usage', value: 42, unit: '%' }]);
});

test('rejects non-authoritative, malformed, ambiguous, and secret-containing failures safely', () => {
  const primary = window(300, 12);
  assert.throws(() => parseCodexbarUsage(payload('opencodego', { primary }, { source: 'local+api' }), go), hasCode('unexpected_source'));
  assert.throws(() => parseCodexbarUsage(payload('opencodego', { primary }, { ageSeconds: 2 }), go), hasCode('unexpected_source'));
  assert.throws(() => parseCodexbarUsage(payload('opencodego', { primary, dataConfidence: 'estimated' }), go), hasCode('no_usage'));
  assert.throws(() => parseCodexbarUsage(payload('opencodego', {
    primary: window(300, 0, { isSyntheticPlaceholder: true }),
  }), go), hasCode('no_usage'));
  assert.throws(() => parseCodexbarUsage(payload('opencodego', {}), go), hasCode('no_usage'));
  assert.throws(() => parseCodexbarUsage(payload('opencodego', {}, { error: { message: secret } }), go), hasCode('cli_failed'));
  for (const stdout of [
    secret, `[{"oops":"${secret}"`, '{}', '[]', JSON.stringify([row('opencodego', { primary }), row('opencodego', { primary })]),
    payload('commandcode', { primary }), payload('opencodego', { primary: window(10080, 50) }),
    payload('opencodego', { primary: window(300, -1) }), payload('opencodego', { primary: { usedPercent: '50' } }),
    payload('opencodego', { primary: window(300, 10, { resetsAt: secret }) }),
    payload('opencodego', { primary: window(300, 10, { resetsAt: '2027-02-30T00:00:00Z' }) }),
  ]) {
    assert.throws(() => parseCodexbarUsage(stdout, go), hasCode('invalid_output'));
  }
});

async function setup(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'quota-bowl-provider-test-'));
  t.after(() => rm(base, { force: true, recursive: true }));
  const binary = join(base, 'fake-codexbar');
  await writeFile(binary, `#!/bin/sh
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(base, 'mock.cjs'))} "$@"
`, { mode: 0o700 });
  await writeFile(join(base, 'mock.cjs'), `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = process.cwd();
const configPath = process.env.CODEXBAR_CONFIG;
assert.equal(fs.realpathSync(path.dirname(configPath)), dir);
assert.equal(fs.realpathSync(process.env.HOME), dir);
assert.equal(fs.realpathSync(process.env.XDG_CONFIG_HOME), dir);
assert.equal(process.env.CODEXBAR_DISABLE_KEYCHAIN_ACCESS, '1');
assert.equal(process.env.OPENCODE_API_KEY, undefined);
assert.equal(process.env.COMMAND_CODE_API_KEY, undefined);
assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
assert.equal(config.version, 1);
assert.equal(config.providers.length, 1);
const provider = config.providers[0];
const source = provider.id === 'opendesign' ? 'web' : 'api';
assert.equal(provider.enabled, true);
assert.equal(provider.source, source);
assert.deepEqual(process.argv.slice(2), ['usage', '--provider', provider.id, '--source', source,
  '--format', 'json', '--json-only', '--no-credits', '--web-timeout', '15']);
let accountID;
let value;
if (provider.id === 'opendesign') {
  assert.equal(provider.cookieSource, 'manual');
  assert.equal(provider.apiKey, undefined);
  assert.equal(provider.workspaceID, undefined);
  const match = /^Cookie: fixture=(workspace-[AB])$/.exec(provider.cookieHeader);
  assert.ok(match);
  accountID = match[1];
  value = accountID === 'workspace-A' ? 23 : 27;
} else {
  assert.equal(provider.cookieSource, 'off');
  assert.equal(provider.cookieHeader, undefined);
  assert.equal(provider.apiKey.startsWith('fixture-key-'), true);
  value = provider.id === 'commandcode' ? 41 : 29;
}
fs.appendFileSync(path.join(__dirname, 'calls'), dir + '\\n');
if (provider.apiKey === 'fixture-key-${secret}') {
  console.error(provider.apiKey, configPath);
  console.log(JSON.stringify([{ provider: provider.id, error: { message: provider.apiKey } }]));
  process.exit(1);
}
if (provider.apiKey === 'fixture-key-timeout') process.exit(4);
console.log(JSON.stringify([{ provider: provider.id, source, usage: {
  identity: { providerID: provider.id, accountID }, primary: { windowMinutes: 300, usedPercent: value },
} }]));
`);
  async function credential(name: string, contents: string) {
    const path = join(base, name);
    await writeFile(path, contents, { mode: 0o600 });
    return path;
  }
  async function verifyCleanup(numCalls: number) {
    const directories = (await readFile(join(base, 'calls'), 'utf8')).trim().split('\n');
    assert.equal(new Set(directories).size, numCalls);
    for (const directory of directories) await assert.rejects(stat(directory), { code: 'ENOENT' });
  }
  return { base, binary, credential, verifyCleanup };
}

test('collect isolates each simultaneous target and injects only its configured credential', async (t) => {
  const { binary, credential, verifyCleanup } = await setup(t);
  const targets = [
    { ...design, credentialFile: await credential('fixture-A', 'Cookie: fixture=workspace-A\n') },
    { ...design, workspaceId: 'workspace-B', credentialFile: await credential('fixture-B', 'Cookie: fixture=workspace-B') },
    { ...go, credentialFile: await credential('fixture-go', 'fixture-key-go\n') },
    { ...command, credentialFile: await credential('fixture-command', 'fixture-key-command\n') },
  ];
  const saved = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = 'ambient-must-not-be-inherited';
  try {
    const actual = await Promise.all(targets.map((target) => collect(target, binary)));
    assert.deepEqual(actual.map((metrics) => metrics.map((metric) => metric.value)), [[23], [27], [29], [41]]);
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = saved;
  }
  await verifyCleanup(4);
});

test('collect sanitizes failed subprocesses and cleans up even on failure', async (t) => {
  const { base, binary, credential, verifyCleanup } = await setup(t);
  const credentialFile = await credential('fixture-failure', `fixture-key-${secret}`);
  await assert.rejects(collect({ ...go, credentialFile }, binary), hasCode('cli_failed'));
  const timeoutFile = await credential('fixture-timeout', 'fixture-key-timeout');
  await assert.rejects(collect({ ...go, credentialFile: timeoutFile }, binary), hasCode('cli_timeout'));
  await assert.rejects(collect({ ...go, credentialFile }, join(base, secret)), hasCode('cli_unavailable'));
  await assert.rejects(collect({ ...go, credentialFile: join(base, secret) }, binary), hasCode('credential_unreadable'));
  const invalidFile = await credential('fixture-multiline', `${secret}\nsecond line`);
  await assert.rejects(collect({ ...go, credentialFile: invalidFile }, binary), hasCode('credential_invalid'));
  await assert.rejects(collect({ provider: 'opendesign', credentialFile: join(base, secret) }, binary), hasCode('workspace_required'));
  const otherWorkspace = await credential('fixture-other-workspace', 'Cookie: fixture=workspace-B');
  await assert.rejects(collect({ ...design, credentialFile: otherWorkspace }, binary), hasCode('workspace_mismatch'));
  await verifyCleanup(3);
});
