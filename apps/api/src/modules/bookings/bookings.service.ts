import { randomInt } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  BookingStatus,
  ErrorCode,
  LedgerEntryType,
  ListingType,
  MAX_ADVANCE_BOOKING_DAYS,
  PaymentStatus,
  RENTAL_PERIODS,
  STAY_LIMITS,
  addDays,
  daysBetween,
  stayEndDate,
  todayInNigeria,
  type BookingQuote,
  type BookingRequest,
  type PropertyAvailability,
  type RentalPeriod,
  type createBookingSchema,
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
import { PricingConfigService } from '../finance/pricing-config.service';
import { RefundsService } from '../finance/refunds.service';
import { PUBLIC_PROPERTY_WHERE, agentDisplayName } from '../properties/property.selects';
import { cancelDecisionFor, type StoredPropertySnapshot } from './booking.mapper';
import { BookingStateService } from './booking-state.service';
import type { CancellationActor } from './booking-lifecycle';
import { AvailabilityService } from './availability.service';
import { PricingError, priceStay, type PricingResult } from './pricing/pricing-engine';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

/** Unpaid bookings one customer may hold at once (stops date-squatting). */
export const MAX_OPEN_HOLDS_PER_CUSTOMER = 3;

const BOOKABLE_SELECT = {
  id: true,
  slug: true,
  title: true,
  propertyType: true,
  listingType: true,
  pricingPeriod: true,
  priceKobo: true,
  discountPercent: true,
  cautionFeeKobo: true,
  cleaningOption: true,
  cleaningFeeKobo: true,
  availableFrom: true,
  maxGuests: true,
  addressLine: true,
  city: true,
  state: true,
  agentProfileId: true,
  images: { where: { isPrimary: true }, take: 1, select: { thumbnailKey: true } },
  agentProfile: { select: { businessName: true, user: { select: { fullName: true } } } },
} satisfies Prisma.PropertySelect;

type BookableProperty = Prisma.PropertyGetPayload<{ select: typeof BOOKABLE_SELECT }>;

interface StayPlan {
  period: RentalPeriod;
  startDate: string;
  endDate: string;
  pricing: PricingResult;
}

export interface CancelActor {
  kind: CancellationActor;
  userId: string;
  /** Scope: the customer's id, the agent's profile id, or none for admins. */
  customerId?: string;
  agentProfileId?: string;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly state: BookingStateService,
    private readonly pricingConfig: PricingConfigService,
    private readonly refunds: RefundsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ── Quote & availability ─────────────────────────────────────────────────

  async quote(input: BookingRequest): Promise<BookingQuote> {
    const config = await this.pricingConfig.require();
    const property = await this.loadBookable(this.prisma, input.propertyId);
    const plan = this.plan(property, input, config, todayInNigeria());
    const available = await this.availability.isAvailable(
      property.id,
      plan.startDate,
      plan.endDate,
    );
    return {
      propertyId: property.id,
      pricingPeriod: plan.period,
      startDate: plan.startDate,
      endDate: plan.endDate,
      quantity: input.quantity,
      guests: input.guests ?? null,
      addCleaning: input.addCleaning,
      available,
      unavailableReason: available ? null : 'Some of these dates are already booked.',
      lines: plan.pricing.lines.map((l) => ({
        kind: l.kind,
        label: l.label,
        amountKobo: koboToNumber(l.amountKobo),
        quantity: l.quantity,
        unitAmountKobo: l.unitAmountKobo === null ? null : koboToNumber(l.unitAmountKobo),
      })),
      totalKobo: koboToNumber(plan.pricing.totalKobo),
      refundableDepositKobo: koboToNumber(plan.pricing.cautionKobo),
      currency: 'NGN',
    };
  }

  async availabilityFor(
    propertyId: string,
    check: { startDate?: string; quantity?: number },
  ): Promise<PropertyAvailability> {
    const property = await this.loadBookable(this.prisma, propertyId);
    const period = rentalPeriodOf(property);
    const earliest = earliestStart(property, todayInNigeria());
    const latest = addDays(todayInNigeria(), MAX_ADVANCE_BOOKING_DAYS);
    const horizonEnd = stayEndDate(latest, period, STAY_LIMITS[period].max);

    let result: PropertyAvailability['check'] = null;
    if (check.startDate && check.quantity) {
      const problem = ruleViolation(period, check.startDate, check.quantity, earliest, latest);
      const endDate = stayEndDate(check.startDate, period, check.quantity);
      const free = problem
        ? false
        : await this.availability.isAvailable(property.id, check.startDate, endDate);
      result = {
        startDate: check.startDate,
        endDate,
        available: free,
        reason: problem?.message ?? (free ? null : 'Some of these dates are already booked.'),
      };
    }
    return {
      propertyId: property.id,
      pricingPeriod: period,
      earliestStartDate: earliest,
      latestStartDate: latest,
      limits: STAY_LIMITS[period],
      unavailable: await this.availability.heldRanges(property.id, earliest, horizonEnd),
      check: result,
    };
  }

  // ── Create ───────────────────────────────────────────────────────────────

  /**
   * Creates an unpaid booking that holds its dates for BOOKING_HOLD_MINUTES.
   * Runs under a lock on the property row, so concurrent attempts for one
   * property are serialised; the exclusion constraint backs this up.
   */
  async create(
    customerId: string,
    input: z.output<typeof createBookingSchema>,
    meta: RequestMeta,
  ): Promise<string> {
    const config = await this.pricingConfig.require();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM properties WHERE id = ${input.propertyId}::uuid FOR UPDATE`;
        const property = await this.loadBookable(tx, input.propertyId);
        const plan = this.plan(property, input, config, todayInNigeria());

        if (
          input.expectedTotalKobo !== undefined &&
          BigInt(input.expectedTotalKobo) !== plan.pricing.totalKobo
        ) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.BOOKING_PRICE_CHANGED,
            'The price of this stay has changed. Please review the new total.',
            { totalKobo: koboToNumber(plan.pricing.totalKobo) },
          );
        }

        await this.state.expireStaleHolds(tx, { propertyId: property.id });
        const openHolds = await tx.booking.count({
          where: {
            customerId,
            status: BookingStatus.AWAITING_PAYMENT,
            holdExpiresAt: { gt: new Date() },
          },
        });
        if (openHolds >= MAX_OPEN_HOLDS_PER_CUSTOMER) {
          throw Errors.conflict(
            'You have several unpaid bookings. Pay for or cancel one before booking again.',
          );
        }
        if (!(await this.availability.isAvailable(property.id, plan.startDate, plan.endDate, tx))) {
          throw datesUnavailable();
        }

        const booking = await tx.booking.create({
          data: {
            reference: bookingReference(),
            customerId,
            propertyId: property.id,
            agentProfileId: property.agentProfileId,
            status: BookingStatus.AWAITING_PAYMENT,
            pricingPeriod: plan.period,
            startDate: new Date(`${plan.startDate}T00:00:00.000Z`),
            endDate: new Date(`${plan.endDate}T00:00:00.000Z`),
            quantity: input.quantity,
            guests: input.guests ?? null,
            cleaningSelected: input.addCleaning,
            stayKobo: plan.pricing.stayKobo,
            cleaningKobo: plan.pricing.cleaningKobo,
            cautionKobo: plan.pricing.cautionKobo,
            serviceFeeKobo: plan.pricing.serviceFeeKobo,
            vatKobo: plan.pricing.vatKobo,
            totalKobo: plan.pricing.totalKobo,
            agentCommissionKobo: plan.pricing.agentCommissionKobo,
            agentPayoutKobo: plan.pricing.agentPayoutKobo,
            pricingConfigId: config.id,
            propertySnapshot: snapshot(property) as unknown as Prisma.InputJsonObject,
            holdExpiresAt: new Date(Date.now() + this.env.BOOKING_HOLD_MINUTES * 60_000),
            lines: {
              create: plan.pricing.lines.map((line, index) => ({
                kind: line.kind,
                label: line.label,
                quantity: line.quantity,
                unitAmountKobo: line.unitAmountKobo,
                amountKobo: line.amountKobo,
                sortOrder: index,
              })),
            },
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
              propertyId: property.id,
              startDate: plan.startDate,
              endDate: plan.endDate,
              totalKobo: booking.totalKobo.toString(),
              pricingConfigVersion: config.version,
            },
            meta,
          },
          tx,
        );
        return booking.id;
      });
    } catch (error) {
      if (isOverlapViolation(error)) throw datesUnavailable();
      throw error;
    }
  }

  // ── Cancel ───────────────────────────────────────────────────────────────

  /**
   * Cancels under the central policy. A paid booking opens a full refund of
   * the payment that confirmed it, for an administrator to process.
   */
  async cancel(
    actor: CancelActor,
    bookingId: string,
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const booking = await this.state.lock(tx, bookingId);
      if (
        (actor.customerId && booking.customerId !== actor.customerId) ||
        (actor.agentProfileId && booking.agentProfileId !== actor.agentProfileId)
      ) {
        throw Errors.notFound('Booking');
      }
      const decision = cancelDecisionFor(booking, actor.kind);
      if (!decision.allowed) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          decision.reason ?? 'This booking cannot be cancelled.',
        );
      }
      await this.state.transition(tx, booking, BookingStatus.CANCELLED, {
        actorId: actor.userId,
        data: {
          cancelledAt: new Date(),
          cancelledBy: actor.kind,
          cancellationReason: reason ?? null,
        },
        detail: { cancelledBy: actor.kind, reason: reason ?? null },
        meta,
      });
      if (decision.refund === 'FULL') {
        const payment = await this.confirmingPayment(tx, booking.id);
        if (payment) {
          await this.refunds.requestInTx(tx, {
            payment,
            reason: `Booking cancelled by ${actor.kind.toLowerCase()}${reason ? `: ${reason}` : ''}`,
            requestedBy: actor.kind,
            actorId: actor.userId,
            meta,
          });
        }
      }
    });
  }

  /** The successful payment that confirmed the booking (not a stray duplicate). */
  async confirmingPayment(tx: Db, bookingId: string) {
    return tx.payment.findFirst({
      where: {
        bookingId,
        status: PaymentStatus.SUCCESS,
        ledgerEntries: { none: { type: LedgerEntryType.UNALLOCATED } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Rules ────────────────────────────────────────────────────────────────

  /** A publicly visible rental. Sale listings never enter the booking flow. */
  private async loadBookable(db: Db, propertyId: string): Promise<BookableProperty> {
    const property = await db.property.findFirst({
      where: { ...PUBLIC_PROPERTY_WHERE, id: propertyId },
      select: BOOKABLE_SELECT,
    });
    if (!property) throw Errors.notFound('Property');
    rentalPeriodOf(property);
    return property;
  }

  private plan(
    property: BookableProperty,
    input: BookingRequest,
    config: PricingConfig,
    today: string,
  ): StayPlan {
    const period = rentalPeriodOf(property);
    const earliest = earliestStart(property, today);
    const latest = addDays(today, MAX_ADVANCE_BOOKING_DAYS);
    const problem = ruleViolation(period, input.startDate, input.quantity, earliest, latest);
    if (problem) throw invalid(problem.path, problem.message);
    if (input.guests && property.maxGuests && input.guests > property.maxGuests) {
      throw invalid('guests', `This property sleeps up to ${property.maxGuests} guests`);
    }

    let pricing: PricingResult;
    try {
      pricing = priceStay({
        period,
        quantity: input.quantity,
        unitPriceKobo: property.priceKobo!,
        discountPercent: property.discountPercent,
        cleaningOption: property.cleaningOption,
        cleaningFeeKobo: property.cleaningFeeKobo,
        addCleaning: input.addCleaning,
        cautionFeeKobo: property.cautionFeeKobo,
        rates: config,
      });
    } catch (error) {
      if (error instanceof PricingError) throw invalid('addCleaning', error.message);
      throw error;
    }
    if (!isSafeKobo(pricing.totalKobo)) {
      throw invalid('quantity', 'This stay is too large to book online. Please contact HavenHub.');
    }
    return {
      period,
      startDate: input.startDate,
      endDate: stayEndDate(input.startDate, period, input.quantity),
      pricing,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ruleViolation(
  period: RentalPeriod,
  startDate: string,
  quantity: number,
  earliest: string,
  latest: string,
): { path: string; message: string } | null {
  const limits = STAY_LIMITS[period];
  if (quantity < limits.min || quantity > limits.max) {
    return {
      path: 'quantity',
      message: `Choose between ${limits.min} and ${limits.max} ${limits.unit}s`,
    };
  }
  if (startDate < earliest) {
    return { path: 'startDate', message: `Choose a start date on or after ${earliest}` };
  }
  if (daysBetween(startDate, latest) < 0) {
    return { path: 'startDate', message: `Bookings open up to ${latest}` };
  }
  return null;
}

function rentalPeriodOf(
  property: Pick<BookableProperty, 'listingType' | 'pricingPeriod' | 'priceKobo'>,
): RentalPeriod {
  if (
    property.listingType !== ListingType.RENT ||
    !property.pricingPeriod ||
    !RENTAL_PERIODS.includes(property.pricingPeriod) ||
    !property.priceKobo
  ) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.PROPERTY_NOT_BOOKABLE,
      property.listingType === ListingType.SALE
        ? 'This property is for sale and cannot be booked.'
        : 'This property cannot be booked online.',
    );
  }
  return property.pricingPeriod as RentalPeriod;
}

function earliestStart(property: Pick<BookableProperty, 'availableFrom'>, today: string): string {
  const from = property.availableFrom?.toISOString().slice(0, 10);
  return from && from > today ? from : today;
}

function snapshot(p: BookableProperty): StoredPropertySnapshot {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    propertyType: p.propertyType,
    pricingPeriod: p.pricingPeriod as RentalPeriod,
    unitPriceKobo: p.priceKobo!.toString(),
    discountPercent: p.discountPercent,
    cleaningOption: p.cleaningOption,
    cleaningFeeKobo: p.cleaningFeeKobo?.toString() ?? null,
    cautionFeeKobo: p.cautionFeeKobo?.toString() ?? null,
    addressLine: p.addressLine,
    city: p.city,
    state: p.state,
    coverThumbnailKey: p.images[0]?.thumbnailKey ?? null,
    agentDisplayName: agentDisplayName(p.agentProfile),
  };
}

const invalid = (path: string, message: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, message, {
    issues: [{ path, message }],
  });

const datesUnavailable = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.DATES_UNAVAILABLE,
    'Sorry, some of these dates were just booked. Please choose different dates.',
  );

/** Postgres exclusion_violation (23P01) on bookings_no_overlap, however the driver wraps it. */
export function isOverlapViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
    if (e.code === '23P01') return true;
    if (typeof e.message === 'string' && e.message.includes('bookings_no_overlap')) return true;
    if (JSON.stringify(e.meta ?? null).includes('23P01')) return true;
    current = e.cause;
  }
  return false;
}

const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** "HH-" + 8 unambiguous characters (32^8 ≈ 10^12 combinations). */
function bookingReference(): string {
  let ref = 'HH-';
  for (let i = 0; i < 8; i++) ref += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return ref;
}
