import { HttpStatus } from '@nestjs/common';
import { BookingStatus as S, CancelledBy, ErrorCode, type BookingStatus } from '@havenhub/shared';

import { AppException } from '../../common/errors/app.exception';

/**
 * The only legal booking state changes. Every write of `Booking.status` goes
 * through `assertTransition` (inside a transaction, after locking the row), so
 * a booking can never jump arbitrarily — e.g. EXPIRED or CANCELLED can never
 * become CONFIRMED.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  [S.AWAITING_PAYMENT]: [S.CONFIRMED, S.CANCELLED, S.EXPIRED],
  [S.CONFIRMED]: [S.CANCELLED, S.COMPLETED],
  [S.CANCELLED]: [],
  [S.EXPIRED]: [],
  [S.COMPLETED]: [],
};

export const canTransition = (from: BookingStatus, to: BookingStatus): boolean =>
  BOOKING_TRANSITIONS[from].includes(to);

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATUS_TRANSITION,
      `A ${label(from)} booking cannot become ${label(to)}.`,
    );
  }
}

const label = (status: BookingStatus) => status.toLowerCase().replace('_', ' ');

export type CancellationActor = Exclude<CancelledBy, 'SYSTEM'>;

export interface CancellationDecision {
  allowed: boolean;
  /** Why not, when not allowed. */
  reason: string | null;
  /** Whether the captured payment is refunded in full. */
  refund: 'FULL' | 'NONE';
}

/**
 * Phase 3's deliberately simple cancellation policy. It lives in one pure
 * function so a configurable policy can replace it later without touching
 * callers.
 *
 *  - Unpaid bookings: anyone involved may cancel; nothing to refund.
 *  - Paid bookings before the stay starts: customer, agent or admin may
 *    cancel; the customer is refunded in full (caution deposit included).
 *  - Once the stay has started only an administrator may cancel (full
 *    refund) — customers and agents must contact support.
 */
export function cancellationDecision(
  booking: { status: BookingStatus; startDate: string },
  actor: CancellationActor,
  today: string,
): CancellationDecision {
  if (booking.status === S.AWAITING_PAYMENT) return { allowed: true, reason: null, refund: 'NONE' };
  if (booking.status !== S.CONFIRMED) {
    return {
      allowed: false,
      reason: `A ${label(booking.status)} booking cannot be cancelled.`,
      refund: 'NONE',
    };
  }
  const started = today >= booking.startDate;
  if (started && actor !== CancelledBy.ADMIN) {
    return {
      allowed: false,
      reason: 'This stay has already started. Please contact HavenHub support.',
      refund: 'NONE',
    };
  }
  return { allowed: true, reason: null, refund: 'FULL' };
}
