import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  BookingStatus,
  ErrorCode,
  PricingPeriod,
  WEEKDAY_LABELS,
  addDays,
  daysBetween,
  todayInNigeria,
  type AppliedDiscount,
  type BookableExperienceKind,
  type ExperienceBookingQuote,
  type ExperienceBookingRequest,
  type Weekday,
  type createExperienceBookingSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { isSafeKobo, koboToNumber } from '../../common/money';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { PricingConfig, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DiscountsService } from '../discounts/discounts.service';
import { canBookOnline } from '../experiences/experience.mapper';
import { PUBLIC_EXPERIENCE_WHERE } from '../experiences/experience.selects';
import { PricingConfigService } from '../finance/pricing-config.service';
import { PlatformPoliciesService } from '../platform/platform-policies.service';
import { agentDisplayName } from '../properties/property.selects';
import type { StoredExperienceSnapshot, StoredSelection } from './booking.mapper';
import { BookingStateService } from './booking-state.service';
import { bookingReference } from './bookings.service';
import {
  PricingError,
  discountedUnit,
  priceExperience,
  type ExperienceLineInput,
  type PricingResult,
} from './pricing/pricing-engine';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;
type CreateInput = z.output<typeof createExperienceBookingSchema>;

/** Statuses that hold capacity (an unpaid hold only until it expires). */
const HOLDING = [BookingStatus.AWAITING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.COMPLETED];

const bookableInclude = (from: Date) =>
  ({
    packageItems: { orderBy: { sortOrder: 'asc' } },
    images: { where: { isPrimary: true }, take: 1, select: { thumbnailKey: true } },
    agentProfile: { select: { businessName: true, user: { select: { fullName: true } } } },
    event: { include: { ticketTypes: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } } },
    tour: { include: { dates: { where: { startsAt: { gte: from } } } } },
    hotel: {
      include: {
        roomTypes: { include: { _count: { select: { rooms: { where: { active: true } } } } } },
      },
    },
    cleaning: true,
  }) satisfies Prisma.ExperienceInclude;

type Bookable = Prisma.ExperienceGetPayload<{ include: ReturnType<typeof bookableInclude> }>;

interface Plan {
  kind: BookableExperienceKind;
  startDate: string;
  endDate: string;
  pricing: PricingResult;
  selection: StoredSelection;
  roomTypeId: string | null;
  /** Hotels: the rooms this booking would hold. */
  roomIds: string[];
  /** Why it cannot be booked (capacity), when not available. */
  unavailableReason: string | null;
  /** The agent's promo code, validated (held when booking). */
  promo: { discountCodeId: string; applied: AppliedDiscount } | null;
}

/**
 * Tour, event and hotel bookings, paid through the same Paystack flow,
 * ledger and refunds as rentals. Everything is per day (per night for
 * hotels): customers take the full package or pick the items they want.
 * Capacity is checked under a lock on the listing row, so two customers
 * cannot both take the last places or rooms.
 */
@Injectable()
export class ExperienceBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: BookingStateService,
    private readonly pricingConfig: PricingConfigService,
    private readonly policies: PlatformPoliciesService,
    private readonly audit: AuditService,
    private readonly discounts: DiscountsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async quote(input: ExperienceBookingRequest): Promise<ExperienceBookingQuote> {
    const config = await this.pricingConfig.require();
    const listing = await this.load(this.prisma, input.experienceId);
    const plan = await this.plan(this.prisma, listing, input, config, null);
    return {
      experienceId: listing.id,
      kind: plan.kind,
      startDate: plan.startDate,
      endDate: plan.endDate,
      days: input.days,
      people: input.people,
      rooms: plan.kind === 'HOTEL' ? (input.rooms ?? 1) : null,
      available: plan.unavailableReason === null,
      unavailableReason: plan.unavailableReason,
      lines: plan.pricing.lines.map((l) => ({
        kind: l.kind,
        label: l.label,
        amountKobo: koboToNumber(l.amountKobo),
        quantity: l.quantity,
        unitAmountKobo: l.unitAmountKobo === null ? null : koboToNumber(l.unitAmountKobo),
      })),
      totalKobo: koboToNumber(plan.pricing.totalKobo),
      promo: plan.promo?.applied ?? null,
      currency: 'NGN',
    };
  }

  /** Creates an unpaid booking that holds its places/rooms for the hold time. */
  async create(customerId: string, input: CreateInput, meta: RequestMeta): Promise<string> {
    const { booking: policy } = await this.policies.get();
    if (!policy.enabled) {
      throw Errors.featureDisabled('HavenHub is not taking new bookings right now.');
    }
    const config = await this.pricingConfig.require();
    const holdMinutes = policy.holdMinutes ?? this.env.BOOKING_HOLD_MINUTES;
    return this.prisma.$transaction(async (tx) => {
      // Serialises bookings of this listing: capacity is checked and taken under it.
      await tx.$queryRaw`SELECT id FROM experiences WHERE id = ${input.experienceId}::uuid FOR UPDATE`;
      await this.state.expireStaleHolds(tx, { experienceId: input.experienceId });
      const listing = await this.load(tx, input.experienceId);
      // Locks the promo code: concurrent bookings cannot both take its last use.
      const plan = await this.plan(tx, listing, input, config, customerId);
      if (plan.unavailableReason) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.DATES_UNAVAILABLE,
          plan.unavailableReason,
        );
      }
      if (
        input.expectedTotalKobo !== undefined &&
        BigInt(input.expectedTotalKobo) !== plan.pricing.totalKobo
      ) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.BOOKING_PRICE_CHANGED,
          'The price has changed. Please review the new total.',
          { totalKobo: koboToNumber(plan.pricing.totalKobo) },
        );
      }
      const openHolds = await tx.booking.count({
        where: {
          customerId,
          status: BookingStatus.AWAITING_PAYMENT,
          holdExpiresAt: { gt: new Date() },
        },
      });
      if (openHolds >= policy.maxOpenHoldsPerCustomer) {
        throw Errors.conflict(
          'You have several unpaid bookings. Pay for or cancel one before booking again.',
        );
      }

      const p = plan.pricing;
      const booking = await tx.booking.create({
        data: {
          reference: bookingReference(),
          customerId,
          experienceId: listing.id,
          agentProfileId: listing.agentProfileId,
          status: BookingStatus.AWAITING_PAYMENT,
          pricingPeriod: PricingPeriod.DAILY,
          startDate: new Date(`${plan.startDate}T00:00:00.000Z`),
          endDate: new Date(`${plan.endDate}T00:00:00.000Z`),
          quantity: input.days,
          guests: input.people,
          rooms: plan.kind === 'HOTEL' ? plan.roomIds.length : null,
          hotelRoomTypeId: plan.roomTypeId,
          selection: plan.selection as unknown as Prisma.InputJsonObject,
          stayKobo: p.stayKobo,
          cleaningKobo: p.cleaningKobo,
          cautionKobo: p.cautionKobo,
          serviceFeeKobo: p.serviceFeeKobo,
          vatKobo: p.vatKobo,
          agencyFeeKobo: p.agencyFeeKobo,
          totalKobo: p.totalKobo,
          agentCommissionKobo: p.agentCommissionKobo,
          agentPayoutKobo: p.agentPayoutKobo,
          pricingConfigId: config.id,
          propertySnapshot: snapshot(listing, plan.kind) as unknown as Prisma.InputJsonObject,
          promoCode: plan.promo?.applied.code ?? null,
          promoDiscountKobo: p.promoKobo,
          holdExpiresAt: new Date(Date.now() + holdMinutes * 60_000),
          lines: {
            create: p.lines.map((line, index) => ({
              kind: line.kind,
              label: line.label,
              quantity: line.quantity,
              unitAmountKobo: line.unitAmountKobo,
              amountKobo: line.amountKobo,
              sortOrder: index,
            })),
          },
          hotelRooms: plan.roomIds.length
            ? { create: plan.roomIds.map((roomId) => ({ roomId })) }
            : undefined,
        },
      });
      await this.audit.record(
        {
          actorId: customerId,
          action: 'booking.created',
          resourceType: 'booking',
          resourceId: booking.id,
          after: {
            reference: booking.reference,
            experienceId: listing.id,
            kind: plan.kind,
            startDate: plan.startDate,
            endDate: plan.endDate,
            totalKobo: booking.totalKobo.toString(),
            pricingConfigVersion: config.version,
            promoCode: booking.promoCode,
            promoDiscountKobo: booking.promoDiscountKobo.toString(),
          },
          meta,
        },
        tx,
      );
      if (plan.promo) {
        // Held while unpaid; the payment redeems it, expiry or cancellation releases it.
        await this.discounts.reserve(tx, {
          discountCodeId: plan.promo.discountCodeId,
          userId: customerId,
          bookingId: booking.id,
          amountOffKobo: plan.promo.applied.amountOffKobo,
        });
      }
      return booking.id;
    });
  }

  // ── Rules ────────────────────────────────────────────────────────────────

  private async load(db: Db, experienceId: string): Promise<Bookable> {
    const listing = await db.experience.findFirst({
      where: {
        ...PUBLIC_EXPERIENCE_WHERE,
        id: experienceId,
        kind: { in: await this.policies.enabledExperienceKinds() },
      },
      include: bookableInclude(new Date()),
    });
    if (!listing) throw Errors.notFound('Listing');
    if (!canBookOnline(listing)) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.PROPERTY_NOT_BOOKABLE,
        'This listing cannot be booked online. Message the provider to arrange it.',
      );
    }
    return listing;
  }

  private async plan(
    db: Db,
    listing: Bookable,
    input: ExperienceBookingRequest,
    config: PricingConfig,
    /** Null for anonymous quotes; when booking, the customer (and the code is locked). */
    customerId: string | null,
  ): Promise<Plan> {
    const kind = listing.kind;
    const today = todayInNigeria();
    const { maxAdvanceDays } = (await this.policies.get()).booking;
    const { startDate, days, people } = input;
    const endDate = addDays(startDate, days);
    if (startDate < today) throw invalid('startDate', 'Choose a date from today onwards');
    if (daysBetween(startDate, addDays(today, maxAdvanceDays)) < 0) {
      throw invalid('startDate', `Bookings open up to ${addDays(today, maxAdvanceDays)}`);
    }

    const dayLabel = `${days} ${kind === 'HOTEL' ? (days === 1 ? 'night' : 'nights') : days === 1 ? 'day' : 'days'}`;
    let serviceArea: string | null = null;
    let address: string | null = null;
    const lines: ExperienceLineInput[] = [];
    let roomTypeId: string | null = null;
    let roomTypeName: string | null = null;
    let roomIds: string[] = [];
    let ticketName: string | null = null;
    let unavailableReason: string | null = null;

    if (kind === 'EVENT') {
      const event = listing.event;
      if (!event?.startsAt) throw invalid('startDate', 'This event has no date yet');
      const first = todayInNigeria(event.startsAt);
      const last = todayInNigeria(event.endsAt ?? event.startsAt);
      if (startDate < first || addDays(endDate, -1) > last) {
        throw invalid(
          'startDate',
          first === last ? `This event is on ${first}` : `This event runs from ${first} to ${last}`,
        );
      }
      if (event.ticketTypes.length) {
        const ticket = event.ticketTypes.find((t) => t.id === input.ticketTypeId);
        if (!ticket) throw invalid('ticketTypeId', 'Choose a ticket');
        ticketName = ticket.name;
        // A free ticket adds nothing to pay; extras may still be booked with it.
        if (ticket.priceKobo > 0n) {
          lines.push({
            kind: 'TICKET',
            label: `${ticket.name} ticket (${dayLabel} × ${plural(people, 'person', 'people')})`,
            quantity: days * people,
            unitAmountKobo: ticket.priceKobo,
            amountKobo: ticket.priceKobo * BigInt(days * people),
          });
        }
      }
      unavailableReason = await this.peopleCapacity(db, listing.id, event.capacity, input);
    } else if (kind === 'TOUR') {
      const runs = listing.tour?.dates.map((d) => todayInNigeria(d.startsAt)) ?? [];
      if (runs.length && !runs.includes(startDate)) {
        throw invalid('startDate', 'Choose one of the dates this tour runs');
      }
      unavailableReason = await this.peopleCapacity(
        db,
        listing.id,
        listing.tour?.capacity ?? null,
        input,
      );
    } else if (kind === 'CLEANING') {
      const cleaning = listing.cleaning;
      const areas = cleaning?.serviceAreas ?? [];
      // A quote may come before the area and address; booking needs both.
      const booking = customerId !== null;
      if (areas.length && (input.serviceArea || booking)) {
        serviceArea =
          areas.find((a) => a.toLowerCase() === input.serviceArea?.toLowerCase()) ?? null;
        if (!serviceArea) {
          throw invalid('serviceArea', 'Choose one of the areas this cleaner covers');
        }
      }
      if (booking && !input.address) throw invalid('address', 'Enter the address to clean');
      address = input.address ?? null;
      const open = cleaning?.availableDays ?? [];
      for (let day = startDate; day < endDate; day = addDays(day, 1)) {
        if (open.length && !open.includes(weekdayOf(day))) {
          throw invalid(
            'startDate',
            `This cleaner works on ${open.map((d) => WEEKDAY_LABELS[d]).join(', ')}`,
          );
        }
      }
      if (cleaning?.priceKobo && cleaning.priceKobo > 0n) {
        lines.push({
          kind: 'CLEANING_FEE',
          label: `Cleaning${cleaning.priceNote ? `, ${cleaning.priceNote}` : ''} (${dayLabel})`,
          quantity: days,
          unitAmountKobo: cleaning.priceKobo,
          amountKobo: cleaning.priceKobo * BigInt(days),
        });
      }
      unavailableReason = await this.dailyCapacity(
        db,
        listing.id,
        cleaning?.dailyCapacity ?? null,
        input,
      );
    } else {
      const type = listing.hotel?.roomTypes.find((t) => t.id === input.roomTypeId);
      if (!type || type._count.rooms === 0) throw invalid('roomTypeId', 'Choose a room type');
      const rooms = input.rooms ?? 1;
      if (type.maxGuests && people > type.maxGuests * rooms) {
        throw invalid(
          'people',
          `${plural(rooms, 'room', 'rooms')} of this type sleep up to ${type.maxGuests * rooms} guests`,
        );
      }
      roomTypeId = type.id;
      roomTypeName = type.name;
      const free = await this.freeRooms(db, type.id, type.priceKobo, startDate, endDate);
      if (free.length < rooms) {
        unavailableReason =
          free.length === 0
            ? 'No rooms of this type are free for these dates.'
            : `Only ${plural(free.length, 'room is', 'rooms are')} free for these dates.`;
      }
      // Cheapest free rooms first; when short, price what was asked at the listed rate.
      const chosen = free.slice(0, rooms);
      roomIds = chosen.map((r) => r.id);
      const total =
        chosen.reduce((sum, r) => sum + r.totalKobo, 0n) +
        type.priceKobo * BigInt(days) * BigInt(rooms - chosen.length);
      lines.push({
        kind: 'ROOM',
        label: `${type.name} (${dayLabel} × ${plural(rooms, 'room', 'rooms')})`,
        quantity: days * rooms,
        unitAmountKobo: null,
        amountKobo: total,
      });
    }

    const items = input.fullPackage
      ? listing.packageItems
      : listing.packageItems.filter((i) => input.itemIds.includes(i.id));
    if (!input.fullPackage && items.length !== input.itemIds.length) {
      throw invalid('itemIds', 'Some items are no longer offered. Please choose again.');
    }
    for (const item of items) {
      const units = item.perPerson ? people : 1;
      lines.push({
        kind: 'PACKAGE_ITEM',
        label: item.perPerson
          ? `${item.name} (${dayLabel} × ${plural(people, 'person', 'people')})`
          : `${item.name} (${dayLabel})`,
        quantity: days * units,
        unitAmountKobo: item.priceKobo,
        amountKobo: item.priceKobo * BigInt(days * units),
      });
    }

    if (lines.length === 0 && ticketName) {
      throw invalid(
        'ticketTypeId',
        'This ticket is free, so there is nothing to pay. Message the organiser to reserve your place.',
      );
    }
    // The promo code may reduce the items after the listing discount (agent-funded).
    let promo: Plan['promo'] = null;
    if (input.code && lines.length) {
      const base = discountedUnit(
        lines.reduce((sum, l) => sum + l.amountKobo, 0n),
        listing.discountPercent,
      );
      if (isSafeKobo(base)) {
        promo = await this.discounts.apply(db, {
          code: input.code,
          userId: customerId,
          target: {
            kind: 'EXPERIENCE',
            experienceId: listing.id,
            ownerAgentProfileId: listing.agentProfileId,
          },
          priceKobo: koboToNumber(base),
          lock: customerId !== null,
        });
      }
    }
    let pricing: PricingResult;
    try {
      pricing = priceExperience({
        lines,
        discountPercent: listing.discountPercent,
        promo: promo
          ? {
              code: promo.applied.code,
              label: promo.applied.label,
              amountOffKobo: BigInt(promo.applied.amountOffKobo),
            }
          : null,
        rates: config,
      });
    } catch (error) {
      if (error instanceof PricingError) throw invalid('itemIds', error.message);
      throw error;
    }
    if (!isSafeKobo(pricing.totalKobo)) {
      throw invalid('days', 'This booking is too large to pay online. Please contact HavenHub.');
    }
    return {
      kind,
      startDate,
      endDate,
      pricing,
      roomTypeId,
      roomIds,
      unavailableReason,
      promo,
      selection: {
        people,
        rooms: kind === 'HOTEL' ? (input.rooms ?? 1) : null,
        roomTypeName,
        ticketName,
        fullPackage: input.fullPackage,
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          category: i.category,
          perPerson: i.perPerson,
        })),
        serviceArea,
        address,
      },
    };
  }

  /** Cleaning: bookings already held on each day must stay under the daily limit. */
  private async dailyCapacity(
    db: Db,
    experienceId: string,
    capacity: number | null,
    input: ExperienceBookingRequest,
  ): Promise<string | null> {
    if (!capacity) return null;
    const endDate = addDays(input.startDate, input.days);
    const overlapping = await db.booking.findMany({
      where: {
        experienceId,
        ...holdingWhere(),
        startDate: { lt: new Date(`${endDate}T00:00:00.000Z`) },
        endDate: { gt: new Date(`${input.startDate}T00:00:00.000Z`) },
      },
      select: { startDate: true, endDate: true },
    });
    for (let day = input.startDate; day < endDate; day = addDays(day, 1)) {
      const at = new Date(`${day}T00:00:00.000Z`);
      const taken = overlapping.filter((b) => b.startDate <= at && b.endDate > at).length;
      if (taken >= capacity) return `${day} is fully booked. Please choose another day.`;
    }
    return null;
  }

  /**
   * Tours and events: on every day of the request, the people already
   * booked plus this request must fit the listing's capacity (none = no limit).
   */
  private async peopleCapacity(
    db: Db,
    experienceId: string,
    capacity: number | null,
    input: ExperienceBookingRequest,
  ): Promise<string | null> {
    if (!capacity) return null;
    if (input.people > capacity) return `At most ${capacity} people can book.`;
    const endDate = addDays(input.startDate, input.days);
    const overlapping = await db.booking.findMany({
      where: {
        experienceId,
        ...holdingWhere(),
        startDate: { lt: new Date(`${endDate}T00:00:00.000Z`) },
        endDate: { gt: new Date(`${input.startDate}T00:00:00.000Z`) },
      },
      select: { startDate: true, endDate: true, guests: true },
    });
    for (let day = input.startDate; day < endDate; day = addDays(day, 1)) {
      const at = new Date(`${day}T00:00:00.000Z`);
      const taken = overlapping
        .filter((b) => b.startDate <= at && b.endDate > at)
        .reduce((sum, b) => sum + (b.guests ?? 1), 0);
      if (taken + input.people > capacity) {
        const left = Math.max(capacity - taken, 0);
        return left === 0
          ? `${day} is fully booked.`
          : `Only ${plural(left, 'place is', 'places are')} left on ${day}.`;
      }
    }
    return null;
  }

  /**
   * Active rooms of a type that are open every night of [start, end) and
   * not held by another booking, with their price for the stay (a date's
   * override, else the room's price, else the type's), cheapest first.
   */
  private async freeRooms(
    db: Db,
    roomTypeId: string,
    typePriceKobo: bigint,
    startDate: string,
    endDate: string,
  ): Promise<{ id: string; totalKobo: bigint }[]> {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    const rooms = await db.hotelRoom.findMany({
      where: {
        roomTypeId,
        active: true,
        availability: { none: { date: { gte: start, lt: end }, available: false } },
        bookings: {
          none: {
            booking: { ...holdingWhere(), startDate: { lt: end }, endDate: { gt: start } },
          },
        },
      },
      orderBy: { label: 'asc' },
      select: {
        id: true,
        priceKobo: true,
        availability: {
          where: { date: { gte: start, lt: end } },
          select: { date: true, priceKobo: true },
        },
      },
    });
    const nights: string[] = [];
    for (let day = startDate; day < endDate; day = addDays(day, 1)) nights.push(day);
    return rooms
      .map((room) => {
        const base = room.priceKobo ?? typePriceKobo;
        const totalKobo = nights.reduce((sum, night) => {
          const override = room.availability.find(
            (a) => a.date.toISOString().slice(0, 10) === night,
          );
          return sum + (override?.priceKobo ?? base);
        }, 0n);
        return { id: room.id, totalKobo };
      })
      .sort((a, b) => (a.totalKobo < b.totalKobo ? -1 : a.totalKobo > b.totalKobo ? 1 : 0));
  }
}

/** Bookings that hold places or rooms: paid ones, and unpaid ones until their hold expires. */
function holdingWhere(): Prisma.BookingWhereInput {
  return {
    status: { in: HOLDING },
    OR: [
      { status: { not: BookingStatus.AWAITING_PAYMENT } },
      { holdExpiresAt: { gt: new Date() } },
    ],
  };
}

function snapshot(e: Bookable, kind: BookableExperienceKind): StoredExperienceSnapshot {
  return {
    kind,
    id: e.id,
    slug: e.slug,
    title: e.title,
    discountPercent: e.discountPercent,
    addressLine: e.addressLine,
    city: e.city,
    state: e.state,
    coverThumbnailKey: e.images[0]?.thumbnailKey ?? null,
    agentDisplayName: agentDisplayName(e.agentProfile),
  };
}

const WEEKDAY_ORDER: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/** The weekday of an ISO calendar date. */
const weekdayOf = (iso: string): Weekday =>
  WEEKDAY_ORDER[new Date(`${iso}T12:00:00Z`).getUTCDay()]!;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const invalid = (path: string, message: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, message, {
    issues: [{ path, message }],
  });
