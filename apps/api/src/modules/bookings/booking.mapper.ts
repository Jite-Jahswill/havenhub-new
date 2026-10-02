import {
  PaymentStatus,
  todayInNigeria,
  type BookingPropertySnapshot,
  type BookingSummary,
  type CancellationView,
  type CleaningOption,
  type PaymentStatus as PaymentStatusType,
  type PriceLine,
  type PropertyType,
  type RentalPeriod,
} from '@havenhub/shared';

import { koboToNumber } from '../../common/money';
import type { Booking, BookingLineItem, Payment, Prisma } from '../../generated/prisma/client';
import type { StorageService } from '../../infrastructure/storage/storage.service';
import { cancellationDecision, type CancellationActor } from './booking-lifecycle';

/** Shape of `Booking.propertySnapshot`. Amounts are kobo strings (JSON has no bigint). */
export interface StoredPropertySnapshot {
  id: string;
  slug: string;
  title: string;
  propertyType: PropertyType;
  pricingPeriod: RentalPeriod;
  unitPriceKobo: string;
  discountPercent: number | null;
  cleaningOption: CleaningOption | null;
  cleaningFeeKobo: string | null;
  cautionFeeKobo: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  coverThumbnailKey: string | null;
  agentDisplayName: string;
}

export const BOOKING_DETAIL_INCLUDE = {
  lines: { orderBy: { sortOrder: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
  earning: true,
  pricingConfig: { select: { version: true } },
  customer: { select: { id: true, fullName: true, email: true, phone: true } },
} satisfies Prisma.BookingInclude;

export type BookingDetailRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_DETAIL_INCLUDE }>;

export const BOOKING_SUMMARY_INCLUDE = {
  payments: { orderBy: { createdAt: 'asc' }, select: { status: true } },
  earning: { select: { status: true } },
  customer: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.BookingInclude;

export type BookingSummaryRow = Prisma.BookingGetPayload<{
  include: typeof BOOKING_SUMMARY_INCLUDE;
}>;

type Urls = Pick<StorageService, 'url'>;

export const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const snapshotOf = (booking: Pick<Booking, 'propertySnapshot'>): StoredPropertySnapshot =>
  booking.propertySnapshot as unknown as StoredPropertySnapshot;

/**
 * The booking's payment status: a settled (or refunded) payment wins over
 * later failed retries; otherwise the most recent attempt.
 */
export function paymentStatusOf(payments: Pick<Payment, 'status'>[]): PaymentStatusType | null {
  const settled = payments.find(
    (p) => p.status === PaymentStatus.SUCCESS || p.status === PaymentStatus.REFUNDED,
  );
  return settled?.status ?? payments.at(-1)?.status ?? null;
}

export function toSnapshotView(booking: Booking, urls: Urls): BookingPropertySnapshot {
  const s = snapshotOf(booking);
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    propertyType: s.propertyType,
    pricingPeriod: s.pricingPeriod,
    unitPriceKobo: koboToNumber(BigInt(s.unitPriceKobo)),
    discountPercent: s.discountPercent,
    cleaningOption: s.cleaningOption,
    addressLine: s.addressLine,
    city: s.city,
    state: s.state,
    coverThumbnailUrl: urls.url(s.coverThumbnailKey),
  };
}

export function toSummary(
  booking: Booking & { payments: Pick<Payment, 'status'>[] },
  urls: Urls,
): BookingSummary {
  const s = snapshotOf(booking);
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    paymentStatus: paymentStatusOf(booking.payments),
    property: {
      id: s.id,
      slug: s.slug,
      title: s.title,
      city: s.city,
      state: s.state,
      coverThumbnailUrl: urls.url(s.coverThumbnailKey),
    },
    pricingPeriod: booking.pricingPeriod as RentalPeriod,
    startDate: isoDate(booking.startDate),
    endDate: isoDate(booking.endDate),
    quantity: booking.quantity,
    totalKobo: koboToNumber(booking.totalKobo),
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
  };
}

export const toPriceLine = (line: BookingLineItem): PriceLine => ({
  kind: line.kind,
  label: line.label,
  amountKobo: koboToNumber(line.amountKobo),
  quantity: line.quantity,
  unitAmountKobo: line.unitAmountKobo === null ? null : koboToNumber(line.unitAmountKobo),
});

export const toCancellation = (b: Booking): CancellationView | null =>
  b.cancelledAt && b.cancelledBy
    ? {
        cancelledAt: b.cancelledAt.toISOString(),
        cancelledBy: b.cancelledBy,
        reason: b.cancellationReason,
      }
    : null;

export function cancelDecisionFor(booking: Booking, actor: CancellationActor) {
  return cancellationDecision(
    { status: booking.status, startDate: isoDate(booking.startDate) },
    actor,
    todayInNigeria(),
  );
}
