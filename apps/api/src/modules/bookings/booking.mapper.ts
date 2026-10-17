import {
  PaymentStatus,
  todayInNigeria,
  type BookableExperienceKind,
  type BookingListingKind,
  type BookingPropertySnapshot,
  type ExperienceSelectionView,
  type PackageItemCategory,
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

/**
 * Shape of `Booking.propertySnapshot` for a rental. Amounts are kobo strings
 * (JSON has no bigint). Rows written before experience bookings have no `kind`.
 */
export interface StoredPropertySnapshot {
  kind?: 'PROPERTY';
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

/** `Booking.propertySnapshot` for a tour, event or hotel booking. */
export interface StoredExperienceSnapshot {
  kind: BookableExperienceKind;
  id: string;
  slug: string;
  title: string;
  discountPercent: number | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  coverThumbnailKey: string | null;
  agentDisplayName: string;
}

export type StoredListingSnapshot = StoredPropertySnapshot | StoredExperienceSnapshot;

/** `Booking.selection`: what an experience booking included (prices are in its lines). */
export interface StoredSelection {
  people: number;
  rooms: number | null;
  roomTypeName: string | null;
  ticketName: string | null;
  fullPackage: boolean;
  items: { id: string; name: string; category: PackageItemCategory; perPerson: boolean }[];
  /** Cleaning only (absent on older rows). */
  serviceArea?: string | null;
  address?: string | null;
}

const EXPERIENCE_PATH: Record<BookableExperienceKind, string> = {
  TOUR: 'tours',
  EVENT: 'events',
  HOTEL: 'hotels',
  CLEANING: 'cleaning',
};

export const listingKindOf = (s: StoredListingSnapshot): BookingListingKind => s.kind ?? 'PROPERTY';

export const isPropertySnapshot = (s: StoredListingSnapshot): s is StoredPropertySnapshot =>
  listingKindOf(s) === 'PROPERTY';

/** The public page of the booked listing. */
export function listingHref(s: StoredListingSnapshot): string {
  return isPropertySnapshot(s) ? `/properties/${s.slug}` : `/${EXPERIENCE_PATH[s.kind]}/${s.slug}`;
}

export function toSelectionView(selection: unknown): ExperienceSelectionView | null {
  if (!selection) return null;
  const s = selection as StoredSelection;
  return {
    people: s.people,
    rooms: s.rooms,
    roomTypeName: s.roomTypeName,
    ticketName: s.ticketName,
    fullPackage: s.fullPackage,
    items: s.items.map((i) => ({ name: i.name, category: i.category, perPerson: i.perPerson })),
    serviceArea: s.serviceArea ?? null,
    address: s.address ?? null,
  };
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

export const snapshotOf = (booking: Pick<Booking, 'propertySnapshot'>): StoredListingSnapshot =>
  booking.propertySnapshot as unknown as StoredListingSnapshot;

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
  const property = isPropertySnapshot(s) ? s : null;
  return {
    kind: listingKindOf(s),
    href: listingHref(s),
    id: s.id,
    slug: s.slug,
    title: s.title,
    propertyType: property?.propertyType ?? null,
    pricingPeriod: booking.pricingPeriod as RentalPeriod,
    unitPriceKobo: property ? koboToNumber(BigInt(property.unitPriceKobo)) : null,
    discountPercent: s.discountPercent,
    cleaningOption: property?.cleaningOption ?? null,
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
      kind: listingKindOf(s),
      href: listingHref(s),
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

export function cancelDecisionFor(
  booking: Booking,
  actor: CancellationActor,
  customerCancelCutoffDays: number,
) {
  return cancellationDecision(
    { status: booking.status, startDate: isoDate(booking.startDate) },
    actor,
    todayInNigeria(),
    customerCancelCutoffDays,
  );
}
