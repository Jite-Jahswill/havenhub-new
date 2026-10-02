import { BookingStatus } from '@havenhub/shared';
import { describe, expect, it } from 'vitest';

import { assertTransition, canTransition, cancellationDecision } from './booking-lifecycle';

const ALL = Object.values(BookingStatus);

describe('booking transitions', () => {
  it('only an unpaid booking can be confirmed', () => {
    for (const from of ALL) {
      expect(canTransition(from, 'CONFIRMED')).toBe(from === 'AWAITING_PAYMENT');
    }
  });

  it('cancelled, expired and completed bookings are final', () => {
    for (const from of ['CANCELLED', 'EXPIRED', 'COMPLETED'] as const) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(false);
        expect(() => assertTransition(from, to)).toThrow(/cannot become/);
      }
    }
  });

  it('only confirmed bookings complete; only unpaid ones expire', () => {
    for (const from of ALL) {
      expect(canTransition(from, 'COMPLETED')).toBe(from === 'CONFIRMED');
      expect(canTransition(from, 'EXPIRED')).toBe(from === 'AWAITING_PAYMENT');
    }
  });
});

describe('cancellation policy', () => {
  const today = '2027-03-10';

  it('unpaid bookings cancel freely with nothing to refund', () => {
    for (const actor of ['CUSTOMER', 'AGENT', 'ADMIN'] as const) {
      expect(
        cancellationDecision({ status: 'AWAITING_PAYMENT', startDate: '2027-03-01' }, actor, today),
      ).toEqual({ allowed: true, reason: null, refund: 'NONE' });
    }
  });

  it('paid bookings refund in full before the stay starts', () => {
    for (const actor of ['CUSTOMER', 'AGENT', 'ADMIN'] as const) {
      expect(
        cancellationDecision({ status: 'CONFIRMED', startDate: '2027-03-11' }, actor, today),
      ).toMatchObject({ allowed: true, refund: 'FULL' });
    }
  });

  it('once the stay starts only an admin may cancel', () => {
    const started = { status: 'CONFIRMED' as const, startDate: today };
    expect(cancellationDecision(started, 'CUSTOMER', today).allowed).toBe(false);
    expect(cancellationDecision(started, 'AGENT', today).allowed).toBe(false);
    expect(cancellationDecision(started, 'ADMIN', today)).toMatchObject({
      allowed: true,
      refund: 'FULL',
    });
  });

  it('final bookings cannot be cancelled by anyone', () => {
    for (const status of ['CANCELLED', 'EXPIRED', 'COMPLETED'] as const) {
      expect(
        cancellationDecision({ status, startDate: '2027-04-01' }, 'ADMIN', today).allowed,
      ).toBe(false);
    }
  });
});
