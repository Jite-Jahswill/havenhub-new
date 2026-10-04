import { describe, expect, it } from 'vitest';

import { parseRequestId } from './request-id.js';

describe('parseRequestId', () => {
  it('accepts UUIDs and platform ids', () => {
    for (const id of [
      '0b9b6a52-6c2e-4f0e-9a5c-1f2d3e4f5a6b',
      'fra1::iad1::q2x7m-1791012345678-abcdef123456',
      'req_ABC.123:xyz',
    ]) {
      expect(parseRequestId(id), id).toBe(id);
    }
  });

  it('rejects malformed, oversized or injected values', () => {
    for (const id of [
      undefined,
      ['abc12345678'],
      '',
      'short',
      'a'.repeat(129),
      'has space 12345',
      'line\nbreak12345',
      '"quoted-12345"',
      '-leading-dash-123',
      'Bearer eyJhbGciOi.token',
    ]) {
      expect(parseRequestId(id), JSON.stringify(id)).toBeNull();
    }
  });
});
