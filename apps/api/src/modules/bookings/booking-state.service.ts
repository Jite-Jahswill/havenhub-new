import { Injectable } from '@nestjs/common';
import { BookingStatus } from '@havenhub/shared';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { Booking, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { assertTransition } from './booking-lifecycle';

type Tx = Prisma.TransactionClient;

/**
 * Applies booking status changes. Callers lock the row first (`lock`), then
 * `transition` validates against the lifecycle table, writes, and audits —
 * all in the caller's transaction.
 */
@Injectable()
export class BookingStateService {
  constructor(private readonly audit: AuditService) {}

  async lock(tx: Tx, bookingId: string): Promise<Booking> {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw Errors.notFound('Booking');
    return booking;
  }

  async transition(
    tx: Tx,
    booking: Booking,
    to: BookingStatus,
    options: {
      actorId: string | null;
      data?: Omit<Prisma.BookingUpdateInput, 'status'>;
      detail?: Record<string, string | null>;
      meta?: RequestMeta;
    },
  ): Promise<Booking> {
    assertTransition(booking.status, to);
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { ...options.data, status: to },
    });
    await this.audit.record(
      {
        actorId: options.actorId,
        action: `booking.${to.toLowerCase()}`,
        resourceType: 'booking',
        resourceId: booking.id,
        before: { status: booking.status },
        after: { status: to, ...options.detail },
        meta: options.meta,
      },
      tx,
    );
    return updated;
  }

  /**
   * Releases unpaid holds that have run out. Called inside booking creation
   * (for one property, under its lock) and by the periodic sweep. Returns
   * how many bookings this call actually expired.
   */
  async expireStaleHolds(tx: Tx, where: Prisma.BookingWhereInput = {}): Promise<number> {
    const stale = await tx.booking.findMany({
      where: {
        ...where,
        status: BookingStatus.AWAITING_PAYMENT,
        holdExpiresAt: { lt: new Date() },
      },
      select: { id: true },
      take: 500,
    });
    let expired = 0;
    for (const { id } of stale) {
      const booking = await this.lock(tx, id);
      // Re-checked under the lock: a concurrent sweep or payment may have won.
      if (booking.status !== BookingStatus.AWAITING_PAYMENT) continue;
      await this.transition(tx, booking, BookingStatus.EXPIRED, {
        actorId: null,
        data: { expiredAt: new Date() },
      });
      expired++;
    }
    return expired;
  }
}
