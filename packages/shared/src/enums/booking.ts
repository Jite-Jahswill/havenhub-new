/**
 * Booking lifecycle (Phase 3). Transitions are validated in one place on the
 * API (`booking-lifecycle.ts`); this is only the vocabulary.
 *
 *   AWAITING_PAYMENT ─┬─▶ CONFIRMED ─┬─▶ COMPLETED
 *                     ├─▶ CANCELLED  └─▶ CANCELLED
 *                     └─▶ EXPIRED
 *
 * Refunds are tracked on their own record (RefundStatus), not as booking
 * states: a cancelled booking may or may not be owed money.
 */
export const BookingStatus = {
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  COMPLETED: 'COMPLETED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

/** Bookings in these states hold their dates; nothing else may overlap them. */
export const DATE_HOLDING_BOOKING_STATUSES: readonly BookingStatus[] = [
  'AWAITING_PAYMENT',
  'CONFIRMED',
  'COMPLETED',
];

/**
 * One payment attempt. Only trusted server-side verification moves a payment
 * out of PENDING — never a browser redirect.
 */
export const PaymentStatus = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentProviderName = {
  PAYSTACK: 'PAYSTACK',
  /** Development-only simulated provider. Refused in production. */
  TEST: 'TEST',
} as const;
export type PaymentProviderName = (typeof PaymentProviderName)[keyof typeof PaymentProviderName];

/** Spec §30, minus states with no behaviour yet. */
export const RefundStatus = {
  REQUESTED: 'REQUESTED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const CancelledBy = {
  CUSTOMER: 'CUSTOMER',
  AGENT: 'AGENT',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const;
export type CancelledBy = (typeof CancelledBy)[keyof typeof CancelledBy];

/**
 * Customer-facing price lines. Future discount codes and gifts become new
 * kinds (negative amounts), without changing the booking model.
 */
export const PriceLineKind = {
  RENT: 'RENT',
  LISTING_DISCOUNT: 'LISTING_DISCOUNT',
  /** The agent's promo code (agent-funded, like the listing discount). */
  PROMO_DISCOUNT: 'PROMO_DISCOUNT',
  CLEANING_FEE: 'CLEANING_FEE',
  CAUTION_FEE: 'CAUTION_FEE',
  SERVICE_FEE: 'SERVICE_FEE',
  VAT: 'VAT',
} as const;
export type PriceLineKind = (typeof PriceLineKind)[keyof typeof PriceLineKind];

/**
 * Where captured money is allocated. For every payment the allocation
 * entries sum to the amount received; a refund writes exact negations.
 */
export const LedgerEntryType = {
  /** HavenHub's customer-side service fee. */
  PLATFORM_SERVICE_FEE: 'PLATFORM_SERVICE_FEE',
  /** HavenHub's commission deducted from the agent's share. */
  PLATFORM_COMMISSION: 'PLATFORM_COMMISSION',
  /** VAT collected, held for remittance. */
  VAT_PAYABLE: 'VAT_PAYABLE',
  /** Rent owed to the agent (after listing discount and commission). */
  AGENT_RENT_PAYABLE: 'AGENT_RENT_PAYABLE',
  /** Cleaning fee owed to the agent who provides cleaning. */
  AGENT_CLEANING_PAYABLE: 'AGENT_CLEANING_PAYABLE',
  /** Refundable caution deposit, held — never HavenHub revenue. */
  CAUTION_HELD: 'CAUTION_HELD',
  /** Money that could not be applied to a booking and is owed back. */
  UNALLOCATED: 'UNALLOCATED',
} as const;
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType];

/**
 * The agent's share of one booking. Withdrawals (a later phase) will add a
 * WITHDRAWN state; a customer paying never marks anything withdrawn.
 */
export const AgentEarningStatus = {
  /** Earned on a confirmed booking, not yet payable (stay has not started). */
  PENDING: 'PENDING',
  /** Payable: the stay has started and the customer can no longer self-cancel. */
  AVAILABLE: 'AVAILABLE',
  /** Refunded to the customer. */
  REVERSED: 'REVERSED',
} as const;
export type AgentEarningStatus = (typeof AgentEarningStatus)[keyof typeof AgentEarningStatus];
