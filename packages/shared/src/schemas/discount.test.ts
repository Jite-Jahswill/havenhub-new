import { describe, expect, it } from 'vitest';

import { bookingRequestSchema } from './booking.js';
import {
  createDiscountCodeSchema,
  createPromoCodeSchema,
  discountAmountKobo,
  discountCodeField,
  discountLabel,
} from './discount.js';

describe('discount codes', () => {
  it('normalise codes to upper case and refuse odd characters', () => {
    expect(discountCodeField.parse(' agent10 ')).toBe('AGENT10');
    expect(discountCodeField.parse('summer-2026')).toBe('SUMMER-2026');
    for (const bad of ['AB', '-LEADING', 'HAS SPACE', 'EMOJI🙂', 'X'.repeat(33)]) {
      expect(discountCodeField.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('compute the amount off and a label', () => {
    expect(discountAmountKobo(1_500_000, { percentOff: 10, amountOffKobo: null })).toBe(150_000);
    expect(discountAmountKobo(999, { percentOff: 33, amountOffKobo: null })).toBe(329);
    expect(discountAmountKobo(50_000, { percentOff: null, amountOffKobo: 80_000 })).toBe(50_000);
    expect(discountLabel({ percentOff: 10, amountOffKobo: null })).toBe('10% off');
    expect(discountLabel({ percentOff: null, amountOffKobo: 500_000 })).toBe('₦5,000 off');
  });

  it('need exactly one kind of discount and an end after the start', () => {
    expect(createDiscountCodeSchema.safeParse({ code: 'ABC', percentOff: 10 }).success).toBe(true);
    expect(createDiscountCodeSchema.safeParse({ code: 'ABC' }).success).toBe(false);
    expect(
      createDiscountCodeSchema.safeParse({ code: 'ABC', percentOff: 10, amountOffKobo: 500 })
        .success,
    ).toBe(false);
    expect(createDiscountCodeSchema.safeParse({ code: 'ABC', percentOff: 91 }).success).toBe(false);
    expect(
      createDiscountCodeSchema.safeParse({
        code: 'ABC',
        percentOff: 10,
        startsAt: '2026-02-01T00:00:00Z',
        endsAt: '2026-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('agent promo codes: one kind, properties by id, never plans or agents', () => {
    expect(
      createPromoCodeSchema.safeParse({ code: 'WEEKEND', percentOff: 15, propertyIds: [] }).success,
    ).toBe(true);
    expect(createPromoCodeSchema.safeParse({ code: 'WEEKEND' }).success).toBe(false);
    expect(
      createPromoCodeSchema.safeParse({ code: 'WEEKEND', percentOff: 15, planIds: [] }).success,
    ).toBe(false);
    expect(
      createPromoCodeSchema.safeParse({ code: 'WEEKEND', percentOff: 15, propertyIds: ['x'] })
        .success,
    ).toBe(false);
  });

  it('booking requests carry an optional, normalised code', () => {
    const base = {
      propertyId: '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      startDate: '2026-12-01',
      quantity: 2,
    };
    expect(bookingRequestSchema.parse({ ...base, code: ' stay10 ' }).code).toBe('STAY10');
    expect(bookingRequestSchema.parse(base).code).toBeUndefined();
    expect(bookingRequestSchema.safeParse({ ...base, code: 'a b' }).success).toBe(false);
  });
});
