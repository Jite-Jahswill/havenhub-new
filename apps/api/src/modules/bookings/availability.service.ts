import { Injectable } from '@nestjs/common';
import { BookingStatus } from '@havenhub/shared';

import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isoDate } from './booking.mapper';

type Db = Pick<PrismaService, 'booking'> | Prisma.TransactionClient;

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Single source of truth for "are these dates free?". A booking holds its
 * dates while confirmed/completed, or while unpaid and its hold has not run
 * out. Stays are half-open [start, end): check-out day = next check-in day.
 *
 * This is the friendly check. The guarantee is the `bookings_no_overlap`
 * exclusion constraint plus the property row lock taken by booking creation,
 * so concurrent requests can never both reserve the same dates.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  holdingWhere(now = new Date()): Prisma.BookingWhereInput {
    return {
      OR: [
        { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] } },
        { status: BookingStatus.AWAITING_PAYMENT, holdExpiresAt: { gt: now } },
      ],
    };
  }

  async isAvailable(
    propertyId: string,
    startDate: string,
    endDate: string,
    db: Db = this.prisma,
  ): Promise<boolean> {
    const clash = await db.booking.findFirst({
      where: {
        propertyId,
        startDate: { lt: day(endDate) },
        endDate: { gt: day(startDate) },
        ...this.holdingWhere(),
      },
      select: { id: true },
    });
    return !clash;
  }

  /** Held ranges overlapping [from, to), for calendars. No customer data. */
  async heldRanges(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<{ startDate: string; endDate: string }[]> {
    const rows = await this.prisma.booking.findMany({
      where: {
        propertyId,
        startDate: { lt: day(to) },
        endDate: { gt: day(from) },
        ...this.holdingWhere(),
      },
      orderBy: { startDate: 'asc' },
      select: { startDate: true, endDate: true },
      take: 500,
    });
    return rows.map((r) => ({ startDate: isoDate(r.startDate), endDate: isoDate(r.endDate) }));
  }
}
