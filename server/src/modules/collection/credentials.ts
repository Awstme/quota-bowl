import { constants, createDecipheriv, createPrivateKey, privateDecrypt } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';

export const maxCredentialBytes = 64 * 1024;

export function normalizeCredential(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || Buffer.byteLength(value) > maxCredentialBytes || /[\u0000-\u001F\u007F\u2028\u2029]/.test(trimmed)
    || Buffer.from(trimmed, 'utf8').toString('utf8') !== trimmed) return;
  return trimmed;
}

type CredentialTarget = { id: string; provider: string; workspaceId?: string };

function context({ id, provider, workspaceId }: CredentialTarget) {
  return Buffer.from(JSON.stringify(['quota-bowl-credential-v1', id, provider, workspaceId ?? null]));
}

export function openLegacyCredential(envelope: string, key: KeyObject | undefined, target: CredentialTarget) {
  if (!key || envelope.length > 2 * maxCredentialBytes) return;
  const [version, wrappedKey, nonce, tag, ciphertext, extra] = envelope.split('.');
  if (version !== 'v1' || !wrappedKey || !nonce || !tag || !ciphertext || extra !== undefined) return;
  try {
    const dataKey = privateDecrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(wrappedKey, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(nonce, 'base64url'), { authTagLength: 16 });
    decipher.setAAD(context(target));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const bytes = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
    return normalizeCredential(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

export function readLegacyPrivateKey(path: string | undefined) {
  if (!path) return;
  try {
    const key = createPrivateKey(readFileSync(path));
    if (key.asymmetricKeyType === 'rsa') return key;
  } catch {
    // Report an unavailable key only when a legacy credential needs it.
  }
}
