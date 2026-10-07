import { z } from 'zod';

import { emailField } from './fields.js';
import { paginationQuerySchema } from './admin.js';

/**
 * What a discount code applies to: agent plans (offered by HavenHub) or
 * property bookings (offered by the agent, who funds the discount).
 */
export const DiscountScope = { SUBSCRIPTION: 'SUBSCRIPTION', BOOKING: 'BOOKING' } as const;
export type DiscountScope = (typeof DiscountScope)[keyof typeof DiscountScope];

/** No code may bring a payment below this (the provider cannot charge ₦0). */
export const MIN_DISCOUNTED_CHARGE_KOBO = 10_000;
export const MAX_PERCENT_OFF = 90;

/** Codes are case-insensitive: stored and compared upper-case. */
export const discountCodeField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/, 'Use 3–32 letters, numbers or dashes');

/** The discount a code gives on `priceKobo`, never more than the price. */
export function discountAmountKobo(
  priceKobo: number,
  discount: { percentOff: number | null; amountOffKobo: number | null },
): number {
  if (discount.percentOff !== null) return Math.floor((priceKobo * discount.percentOff) / 100);
  return Math.min(priceKobo, discount.amountOffKobo ?? 0);
}

/** "10% off" / "₦5,000 off". */
export function discountLabel(discount: {
  percentOff: number | null;
  amountOffKobo: number | null;
}): string {
  if (discount.percentOff !== null) return `${discount.percentOff}% off`;
  const naira = (discount.amountOffKobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { maximumFractionDigits: 2 })} off`;
}

const optionalDate = z.iso
  .datetime({ offset: true })
  .nullable()
  .optional()
  .transform((v): Date | null | undefined => (v == null ? v : new Date(v)));

const discountFields = {
  code: discountCodeField,
  description: z
    .string()
    .trim()
    .max(300)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  percentOff: z.number().int().min(1).max(MAX_PERCENT_OFF).nullable().optional(),
  amountOffKobo: z.number().int().min(100).max(1_000_000_000).nullable().optional(),
  /** Empty or missing = every paid plan. */
  planIds: z.array(z.uuid()).max(50).optional(),
  /** Agents (by email) who may use it; empty or missing = any agent. */
  agentEmails: z.array(emailField).max(500).optional(),
  startsAt: optionalDate,
  endsAt: optionalDate,
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perUserLimit: z.number().int().min(1).max(100).optional(),
};

const window = (v: { startsAt?: Date | null; endsAt?: Date | null }) =>
  !v.startsAt || !v.endsAt || v.startsAt < v.endsAt;
const WINDOW = { path: ['endsAt'], message: 'The end must be after the start' };

const ONE_KIND = {
  path: ['percentOff'],
  message: 'Set either a percentage or a fixed amount',
};
const oneKind = (v: { percentOff?: number | null; amountOffKobo?: number | null }) =>
  (v.percentOff != null) !== (v.amountOffKobo != null);

export const createDiscountCodeSchema = z
  .object(discountFields)
  .strict()
  .refine(oneKind, ONE_KIND)
  .refine(window, WINDOW);
export type CreateDiscountCodeInput = z.input<typeof createDiscountCodeSchema>;

/** What may change after creation (not the code or its value: create a new code instead). */
export const updateDiscountCodeSchema = z
  .object({
    active: z.boolean(),
    description: discountFields.description,
    endsAt: optionalDate,
    maxRedemptions: discountFields.maxRedemptions,
    agentEmails: discountFields.agentEmails,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateDiscountCodeInput = z.input<typeof updateDiscountCodeSchema>;

/** An agent's promo code for their own property bookings. */
export const createPromoCodeSchema = z
  .object({
    code: discountFields.code,
    description: discountFields.description,
    percentOff: discountFields.percentOff,
    amountOffKobo: discountFields.amountOffKobo,
    /** Your properties it applies to; empty or missing = all of them. */
    propertyIds: z.array(z.uuid()).max(200).optional(),
    startsAt: discountFields.startsAt,
    endsAt: discountFields.endsAt,
    maxRedemptions: discountFields.maxRedemptions,
    perUserLimit: discountFields.perUserLimit,
  })
  .strict()
  .refine(oneKind, ONE_KIND)
  .refine(window, WINDOW);
export type CreatePromoCodeInput = z.input<typeof createPromoCodeSchema>;

export const updatePromoCodeSchema = z
  .object({
    active: z.boolean(),
    description: discountFields.description,
    endsAt: optionalDate,
    maxRedemptions: discountFields.maxRedemptions,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdatePromoCodeInput = z.input<typeof updatePromoCodeSchema>;

export const discountCodeListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(32).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type DiscountCodeListQuery = z.input<typeof discountCodeListQuerySchema>;

export interface AdminDiscountCodeView {
  id: string;
  code: string;
  scope: DiscountScope;
  description: string | null;
  percentOff: number | null;
  amountOffKobo: number | null;
  label: string;
  /** Plan codes: the plans it covers (empty = all paid plans). */
  plans: { id: string; name: string }[];
  /** Plan codes: who may use it (empty = any agent). */
  agents: { agentProfileId: string; name: string; email: string }[];
  /** Booking codes: the agent's properties it covers (empty = all of them). */
  properties: { id: string; title: string }[];
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  active: boolean;
  /** Paid uses. */
  redeemed: number;
  /** Checkouts in progress holding a use. */
  pending: number;
  /** Total taken off paid plans or bookings, in kobo. */
  discountGivenKobo: number;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface AdminDiscountCodeDetail extends AdminDiscountCodeView {
  redemptions: {
    id: string;
    /** The agent (plans) or customer (bookings). Agents see customers' names only. */
    user: { name: string; email: string | null };
    amountOffKobo: number;
    status: 'PENDING' | 'REDEEMED' | 'RELEASED';
    /** Payment reference (plans) or booking reference (bookings). */
    reference: string;
    /** Plan name or property title. */
    item: string;
    createdAt: string;
  }[];
}

/** A code applied to a quote. */
export interface AppliedDiscount {
  code: string;
  label: string;
  amountOffKobo: number;
}
