import { describe, expect, it } from 'vitest';

import { requestIdHeaders } from './request-id';

describe('requestIdHeaders', () => {
  it('forwards a well-formed incoming id, else Vercel’s id', () => {
    expect(requestIdHeaders(new Headers({ 'x-request-id': 'abc-12345678' }))).toEqual({
      'x-request-id': 'abc-12345678',
    });
    expect(
      requestIdHeaders(new Headers({ 'x-vercel-id': 'fra1::iad1::q2x7m-1791012345678-abc' })),
    ).toEqual({ 'x-request-id': 'fra1::iad1::q2x7m-1791012345678-abc' });
  });

  it('forwards nothing malformed (the API then generates its own)', () => {
    expect(requestIdHeaders(new Headers())).toEqual({});
    expect(requestIdHeaders(new Headers({ 'x-request-id': 'bad id\twith tab' }))).toEqual({});
    expect(requestIdHeaders(new Headers({ 'x-request-id': 'x'.repeat(200) }))).toEqual({});
  });
});
