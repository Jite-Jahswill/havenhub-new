import { describe, expect, it } from 'vitest';

import { formatKobo, nairaToKobo } from './money.js';

describe('nairaToKobo', () => {
  it('converts naira to integer kobo', () => {
    expect(nairaToKobo(5000)).toBe(500_000);
    expect(nairaToKobo(19.99)).toBe(1999);
  });

  it('avoids floating point drift', () => {
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
  });

  it('rejects non-finite values', () => {
    expect(() => nairaToKobo(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatKobo', () => {
  it('formats whole naira without decimals', () => {
    expect(formatKobo(500_000)).toBe('₦5,000');
  });

  it('formats fractional naira with two decimals', () => {
    expect(formatKobo(1999)).toBe('₦19.99');
  });

  it('rejects fractional kobo', () => {
    expect(() => formatKobo(10.5)).toThrow(RangeError);
  });
});
