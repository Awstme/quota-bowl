import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify, TextDecoder } from 'node:util';
import { maxCredentialBytes, normalizeCredential } from '../credentials.js';

export type Provider = 'opendesign' | 'opencodego' | 'commandcode';
export type Metric = { key: string; label: string; value: number; unit: string; resetsAt?: string };
export type CollectorTarget = { provider: Provider; credentialFile?: string; workspaceId?: string };

const messages = {
  workspace_required: 'A valid OpenDesign workspace ID is required.',
  workspace_unverified: 'CodexBar did not verify an OpenDesign workspace ID.',
  workspace_mismatch: 'The OpenDesign workspace did not match the configured workspace.',
  credential_decryption_failed: 'Could not decrypt the managed provider credential.',
  credential_missing: 'No provider credential is configured.',
  credential_unreadable: 'Could not read the provider credential file.',
  credential_invalid: 'The provider credential file does not contain a valid credential.',
  cli_setup_failed: 'Could not prepare the isolated CodexBar configuration.',
  cli_cleanup_failed: 'Could not clean up the isolated CodexBar configuration.',
  cli_unavailable: 'Could not start the CodexBar CLI.',
  cli_timeout: 'CodexBar timed out collecting usage.',
  cli_failed: 'CodexBar could not collect usage for this provider.',
  invalid_output: 'CodexBar returned an unexpected usage response.',
  unexpected_source: 'CodexBar did not use the requested usage source.',
  no_usage: 'CodexBar returned no measured quota windows.',
} as const;

type ErrorCode = keyof typeof messages;

export class CollectionError extends Error {
  constructor(readonly code: ErrorCode) {
    super(messages[code]);
    this.name = 'CollectionError';
  }
}

const sourceFor = { opendesign: 'web', opencodego: 'api', commandcode: 'api' } as const;
const workspacePattern = /^[A-Za-z0-9_-]{1,128}$/;
const exec = promisify(execFile);
const windows = [
  { slot: 'primary', minutes: 300, key: '5h_used_percent', label: '5-hour usage' },
  { slot: 'secondary', minutes: 10080, key: 'weekly_used_percent', label: 'Weekly usage' },
  { slot: 'tertiary', minutes: 43200, key: 'monthly_used_percent', label: 'Monthly usage' },
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requireWorkspace(target: Pick<CollectorTarget, 'provider' | 'workspaceId'>): string | undefined {
  if (target.provider !== 'opendesign') return undefined;
  if (typeof target.workspaceId !== 'string' || !workspacePattern.test(target.workspaceId)) {
    throw new CollectionError('workspace_required');
  }
  return target.workspaceId;
}

function resetTime(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  // CodexBar v0.85.0 encodes dates with JSONEncoder's .iso8601 strategy.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new CollectionError('invalid_output');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new CollectionError('invalid_output');
  const iso = date.toISOString();
  if (iso.slice(0, 19) !== value.slice(0, 19)) throw new CollectionError('invalid_output');
  return iso;
}

export function parseCodexbarUsage(
  stdout: string,
  target: Pick<CollectorTarget, 'provider' | 'workspaceId'>,
): Metric[] {
  const expectedWorkspace = requireWorkspace(target);
  let decoded: unknown;
  try {
    decoded = JSON.parse(stdout);
  } catch {
    // JSON.parse errors may quote the original input.
    throw new CollectionError('invalid_output');
  }
  // The explicit single-provider command emits a one-element array.
  if (!Array.isArray(decoded) || decoded.length !== 1) throw new CollectionError('invalid_output');
  const row = record(decoded[0]);
  if (!row) throw new CollectionError('invalid_output');
  if (row.error != null) throw new CollectionError('cli_failed');
  if (row.provider !== target.provider) throw new CollectionError('invalid_output');
  if (row.source !== sourceFor[target.provider] || row.ageSeconds != null) {
    throw new CollectionError('unexpected_source');
  }
  const usage = record(row.usage);
  if (expectedWorkspace !== undefined) {
    const identity = record(usage?.identity);
    const accountId = identity?.accountID;
    if (identity?.providerID !== 'opendesign' || typeof accountId !== 'string' || !workspacePattern.test(accountId)) {
      throw new CollectionError('workspace_unverified');
    }
    if (accountId !== expectedWorkspace) throw new CollectionError('workspace_mismatch');
  }
  if (!usage) throw new CollectionError('invalid_output');
  if (usage.dataConfidence === 'estimated' || usage.dataConfidence === 'unknown') {
    throw new CollectionError('no_usage');
  }

  const metrics: Metric[] = [];
  for (const { slot, minutes, key, label } of windows) {
    if (target.provider === 'opendesign' && slot === 'tertiary') continue;
    if (usage[slot] == null) continue;
    const window = record(usage[slot]);
    if (!window) throw new CollectionError('invalid_output');
    if (window.isSyntheticPlaceholder === true) continue;
    const value = window.usedPercent;
    if (window.windowMinutes !== minutes || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new CollectionError('invalid_output');
    }
    const resetsAt = resetTime(window.resetsAt);
    metrics.push({ key, label, value, unit: '%', ...(resetsAt === undefined ? {} : { resetsAt }) });
  }
  if (metrics.length === 0) throw new CollectionError('no_usage');
  return metrics;
}

export async function readCredentialFile(file: string): Promise<string> {
  // Only read the configured file, avoid blocking on non-regular files, and bound the read.
  let bytes: Buffer;
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxCredentialBytes) throw new CollectionError('credential_invalid');
      const buffer = Buffer.alloc(maxCredentialBytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      bytes = buffer.subarray(0, offset);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof CollectionError) throw error;
    throw new CollectionError('credential_unreadable');
  }
  if (bytes.length > maxCredentialBytes) throw new CollectionError('credential_invalid');
  try {
    const value = normalizeCredential(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value) return value;
  } catch {
    // Do not include the decoder error or file contents.
  }
  throw new CollectionError('credential_invalid');
}

async function runCodexbar(binary: string, provider: Provider, directory: string, configPath: string): Promise<string> {
  try {
    const executable = binary.includes('/') ? resolve(binary) : binary;
    const { stdout } = await exec(executable, [
      'usage', '--provider', provider, '--source', sourceFor[provider],
      '--format', 'json', '--json-only', '--no-credits', '--web-timeout', '15',
    ], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      maxBuffer: 256 * 1024,
      // Do not let inherited provider keys, browser settings, or debug flags override this target.
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: directory,
        CFFIXED_USER_HOME: directory,
        XDG_CONFIG_HOME: directory,
        XDG_CACHE_HOME: directory,
        XDG_DATA_HOME: directory,
        XDG_STATE_HOME: directory,
        CODEXBAR_CONFIG: configPath,
        CODEXBAR_DISABLE_KEYCHAIN_ACCESS: '1',
      },
    });
    return stdout;
  } catch (error) {
    const failure = record(error);
    // Node's exec error can carry the full stderr, stdout, and command; never pass it through.
    if (failure?.code === 'ENOENT' || failure?.code === 'EACCES' || failure?.code === 'ENOEXEC') {
      throw new CollectionError('cli_unavailable');
    }
    if (failure?.killed === true || failure?.code === 4) throw new CollectionError('cli_timeout');
    if (failure?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new CollectionError('invalid_output');
    throw new CollectionError('cli_failed');
  }
}

export async function collect(target: CollectorTarget, binary: string, managedCredential?: string): Promise<Metric[]> {
  const input = { ...target };
  requireWorkspace(input);
  const credential = managedCredential ?? (input.credentialFile ? await readCredentialFile(input.credentialFile) : undefined);
  if (credential === undefined) throw new CollectionError('credential_missing');
  const provider = input.provider;
  const source = sourceFor[provider];
  const auth = provider === 'opendesign'
    ? { cookieSource: 'manual', cookieHeader: credential }
    : { cookieSource: 'off', apiKey: credential };
  let directory: string;
  try {
    directory = await mkdtemp(join(tmpdir(), 'quota-bowl-codexbar-'));
  } catch {
    throw new CollectionError('cli_setup_failed');
  }
  try {
    const configPath = join(directory, 'config.json');
    try {
      await writeFile(configPath, JSON.stringify({ version: 1, providers: [{ id: provider, enabled: true, source, ...auth }] }), {
        flag: 'wx', mode: 0o600,
      });
    } catch {
      throw new CollectionError('cli_setup_failed');
    }
    return parseCodexbarUsage(await runCodexbar(binary, provider, directory, configPath), input);
  } finally {
    try {
      await rm(directory, { force: true, recursive: true });
    } catch {
      throw new CollectionError('cli_cleanup_failed');
    }
  }
}
