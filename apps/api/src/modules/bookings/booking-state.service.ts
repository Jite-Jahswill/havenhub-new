import { Injectable } from '@nestjs/common';
import { BookingStatus } from '@havenhub/shared';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { Booking, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { BadgesService } from '../badges/badges.service';
import { DiscountsService } from '../discounts/discounts.service';
import { bookingMessages } from '../notifications/notification-messages';
import { NotificationsService } from '../notifications/notifications.service';
import { assertTransition } from './booking-lifecycle';
import type { StoredPropertySnapshot } from './booking.mapper';

type Tx = Prisma.TransactionClient;

/**
 * Applies booking status changes. Callers lock the row first (`lock`), then
 * `transition` validates against the lifecycle table, writes, and audits —
 * all in the caller's transaction.
 */
@Injectable()
export class BookingStateService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly discounts: DiscountsService,
    private readonly badges: BadgesService,
  ) {}

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
    await this.notify(tx, updated, booking.status, options.actorId);
    // A promo code is used once the booking is paid; given back if it never is (or is cancelled).
    if (to === BookingStatus.CONFIRMED) {
      await this.discounts.settle(tx, { bookingId: booking.id }, 'REDEEMED');
    } else if (to === BookingStatus.CANCELLED || to === BookingStatus.EXPIRED) {
      await this.discounts.settle(tx, { bookingId: booking.id }, 'RELEASED');
    } else if (to === BookingStatus.COMPLETED) {
      // A completed stay counts towards booking-based badges.
      await tx.property.update({
        where: { id: booking.propertyId },
        data: { completedBookings: { increment: 1 } },
      });
      await this.badges.recompute(tx, { propertyIds: [booking.propertyId] });
    }
    return updated;
  }

  /** In-app notifications for the change, in the same transaction. */
  private async notify(tx: Tx, booking: Booking, from: BookingStatus, actorId: string | null) {
    const build = {
      [BookingStatus.CONFIRMED]: bookingMessages.confirmed,
      [BookingStatus.CANCELLED]: (b: Parameters<typeof bookingMessages.confirmed>[0]) =>
        bookingMessages.cancelled(b, actorId, from === BookingStatus.CONFIRMED),
      [BookingStatus.EXPIRED]: bookingMessages.expired,
    }[booking.status as string];
    if (!build) return;
    const agent = await tx.agentProfile.findUniqueOrThrow({
      where: { id: booking.agentProfileId },
      select: { userId: true },
    });
    const snapshot = booking.propertySnapshot as unknown as StoredPropertySnapshot;
    await this.notifications.notify(
      tx,
      build({
        id: booking.id,
        reference: booking.reference,
        title: snapshot.title,
        startDate: booking.startDate,
        endDate: booking.endDate,
        customerId: booking.customerId,
        agentUserId: agent.userId,
      }),
    );
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
