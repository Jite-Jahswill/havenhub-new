import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  composeSessionToken,
  generateSecret,
  parseSessionToken,
  safeEqual,
  safeEqualHex,
  sha256,
} from './tokens';

describe('tokens', () => {
  it('generates distinct high-entropy secrets', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it('round-trips session tokens', () => {
    const id = randomUUID();
    const secret = generateSecret();
    expect(parseSessionToken(composeSessionToken(id, secret))).toEqual({ sessionId: id, secret });
  });

  it.each(['', 'abc', 'not-a-uuid.secretsecretsecretsecretsecretsecret', `${randomUUID()}.short`])(
    'rejects malformed token %j',
    (token) => {
      expect(parseSessionToken(token)).toBeNull();
    },
  );

  it('compares digests in constant time', () => {
    expect(safeEqualHex(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
    expect(safeEqual('csrf', 'csrf')).toBe(true);
    expect(safeEqual('csrf', 'CSRF')).toBe(false);
  });
});
