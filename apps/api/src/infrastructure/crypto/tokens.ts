import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit URL-safe random secret. */
export const generateSecret = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** SHA-256 hex digest — used to store token secrets without keeping the secret. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Constant-time comparison of two hex digests of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** Constant-time comparison of two arbitrary strings. */
export function safeEqual(a: string, b: string): boolean {
  return safeEqualHex(sha256(a), sha256(b));
}

/**
 * Session tokens are `<sessionId>.<secret>`. The id allows a primary-key
 * lookup; the secret is verified against its stored hash in constant time.
 */
export function composeSessionToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSessionToken(token: string): { sessionId: string; secret: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID.test(sessionId) || secret.length < 32 || secret.length > 128) return null;
  return { sessionId, secret };
}
