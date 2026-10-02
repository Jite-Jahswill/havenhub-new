import { z } from 'zod';

import { BookingStatus, PaymentStatus, RefundStatus } from '../enums/booking.js';
import { MAX_PRICE_KOBO } from './property.js';
import { paginationQuerySchema } from './admin.js';

/**
 * What a customer asks for. Prices, fees, VAT and ownership are never
 * accepted from clients: unknown keys are stripped and the API calculates
 * every amount itself.
 */
export const bookingRequestSchema = z.object({
  propertyId: z.uuid(),
  startDate: z.iso.date('Choose a start date'),
  /** Nights (daily), months (monthly) or years (yearly). Range checked per period by the API. */
  quantity: z.number().int().min(1).max(366),
  guests: z.number().int().min(1).max(200).optional(),
  addCleaning: z.boolean().default(false),
});
export type BookingRequestInput = z.input<typeof bookingRequestSchema>;
export type BookingRequest = z.output<typeof bookingRequestSchema>;

export const createBookingSchema = bookingRequestSchema.extend({
  /**
   * The total the customer was shown. If the server's figure differs (the
   * agent changed the price, fees changed) the booking is refused so the
   * customer never pays an amount they did not see.
   */
  expectedTotalKobo: z.number().int().min(0).max(MAX_PRICE_KOBO).optional(),
});
export type CreateBookingInput = z.input<typeof createBookingSchema>;

export const availabilityQuerySchema = z.object({
  startDate: z.iso.date().optional(),
  quantity: z.coerce.number().int().min(1).max(366).optional(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelBookingInput = z.input<typeof cancelBookingSchema>;

export const listBookingsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(BookingStatus).optional(),
});

export const adminListBookingsQuerySchema = listBookingsQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
});

export const adminListPaymentsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PaymentStatus).optional(),
});

export const adminListRefundsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RefundStatus).optional(),
});

export const reviewRefundSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.action !== 'REJECT' || Boolean(v.note), {
    path: ['note'],
    message: 'Give a reason for rejecting the refund',
  });
export type ReviewRefundInput = z.input<typeof reviewRefundSchema>;

/** Basis points: 100 bps = 1%. Capped at 50% as a typo guard. */
const bps = z.number().int().min(0).max(5000);

/**
 * Commission, VAT and fee rates (spec §29). Admin-configured; each change
 * creates a new immutable version and bookings keep the version they used.
 */
export const pricingConfigSchema = z.object({
  /** Customer-side HavenHub fee, on the stay (rent after listing discount). */
  serviceFeeBps: bps,
  /** HavenHub commission deducted from the agent's share, on the stay. */
  agentCommissionBps: bps,
  /** Government VAT rate. */
  vatBps: bps,
  /** Charge VAT on HavenHub's service fee. */
  vatOnServiceFee: z.boolean(),
  /** Charge VAT on the stay and cleaning (e.g. commercial lets). */
  vatOnStay: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export type PricingConfigInput = z.input<typeof pricingConfigSchema>;

/** Development test provider: the outcome the developer chooses on the fake checkout. */
export const testCheckoutSchema = z.object({
  outcome: z.enum(['success', 'failed']),
});
