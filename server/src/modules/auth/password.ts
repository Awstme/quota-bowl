import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const keyLength = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, keyLength);
  return { salt, hash };
}

export function matchesPassword(password: string, salt: Uint8Array, hash: Uint8Array) {
  return timingSafeEqual(scryptSync(password, salt, keyLength), hash);
}
