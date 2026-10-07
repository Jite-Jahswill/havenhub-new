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

  it('the refunds policy cut-off limits customers only, counted in days before check-in', () => {
    const inThreeDays = { status: 'CONFIRMED' as const, startDate: '2027-03-13' };
    expect(cancellationDecision(inThreeDays, 'CUSTOMER', today, 3)).toMatchObject({
      allowed: true,
      refund: 'FULL',
    });
    expect(cancellationDecision(inThreeDays, 'CUSTOMER', today, 4)).toMatchObject({
      allowed: false,
      refund: 'NONE',
      reason: expect.stringContaining('up to 4 days before check-in') as string,
    });
    expect(cancellationDecision(inThreeDays, 'AGENT', today, 4).allowed).toBe(true);
    expect(cancellationDecision(inThreeDays, 'ADMIN', today, 4).allowed).toBe(true);
    // Unpaid bookings are never limited.
    expect(
      cancellationDecision({ ...inThreeDays, status: 'AWAITING_PAYMENT' }, 'CUSTOMER', today, 30)
        .allowed,
    ).toBe(true);
  });

  it('final bookings cannot be cancelled by anyone', () => {
    for (const status of ['CANCELLED', 'EXPIRED', 'COMPLETED'] as const) {
      expect(
        cancellationDecision({ status, startDate: '2027-04-01' }, 'ADMIN', today).allowed,
      ).toBe(false);
    }
  });
});
