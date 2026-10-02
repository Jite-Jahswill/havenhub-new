import { z } from 'zod';

import {
  AgentSubscriptionStatus,
  BillingInterval,
  EntitlementKey,
  SubscriptionPlanStatus,
} from '../enums/subscription.js';
import { paginationQuerySchema } from './admin.js';

/** Upper bound for any single limit — a typo guard, not a business rule. */
export const MAX_ENTITLEMENT_LIMIT = 1_000_000;
/** ₦100,000,000 per interval: a typo guard for plan prices. */
export const MAX_PLAN_PRICE_KOBO = 10_000_000_000;

/** A limit: a whole number ≥ 0, or null for unlimited. */
const limitField = z
  .number({ error: 'Enter a whole number, or leave unlimited' })
  .int('Enter a whole number')
  .min(0, 'Limits cannot be negative')
  .max(MAX_ENTITLEMENT_LIMIT, 'That limit is too large')
  .nullable();

/**
 * Every entitlement must be stated explicitly — 0 for "not included", null
 * for unlimited — so an omitted field can never silently grant or remove
 * an allowance.
 */
export const planEntitlementsSchema = z.object(
  Object.fromEntries(Object.values(EntitlementKey).map((k) => [k, limitField])) as Record<
    EntitlementKey,
    typeof limitField
  >,
);
export type PlanEntitlementsInput = z.input<typeof planEntitlementsSchema>;

const planSlugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens');

const planFields = {
  name: z.string().trim().min(2, 'Enter a plan name').max(60),
  description: z.string().trim().max(500).nullable().optional(),
  rank: z.number().int().min(0).max(1000),
  features: z.array(z.string().trim().min(1).max(120)).max(8),
  entitlements: planEntitlementsSchema,
};

const priceField = z
  .number()
  .int('Price must be in whole kobo')
  .min(100, 'Paid plans cost at least ₦1')
  .max(MAX_PLAN_PRICE_KOBO, 'That price is too large');

/** A new paid plan. The free default plan is seeded, never created here. */
export const createSubscriptionPlanSchema = z.object({
  ...planFields,
  features: planFields.features.default([]),
  slug: planSlugField.optional(),
  priceKobo: priceField,
  billingInterval: z.enum(BillingInterval),
  status: z
    .enum([SubscriptionPlanStatus.ACTIVE, SubscriptionPlanStatus.INACTIVE])
    .default('ACTIVE'),
});
export type CreateSubscriptionPlanInput = z.input<typeof createSubscriptionPlanSchema>;

/**
 * Edits. Price and interval changes apply to future purchases only — terms
 * already paid keep what they were bought at. They are refused for the
 * free default plan. Limit changes apply to every subscriber immediately.
 */
export const updateSubscriptionPlanSchema = z
  .object({
    ...planFields,
    priceKobo: priceField,
    billingInterval: z.enum(BillingInterval),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateSubscriptionPlanInput = z.input<typeof updateSubscriptionPlanSchema>;

export const setSubscriptionPlanStatusSchema = z.object({
  status: z.enum(SubscriptionPlanStatus),
});

export const adminListSubscriptionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(AgentSubscriptionStatus).optional(),
  planId: z.uuid().optional(),
  search: z.string().trim().max(120).optional(),
});

export const adminSubscriptionActionSchema = z.object({
  action: z.enum(['CANCEL', 'SUSPEND', 'REACTIVATE']),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});
export type AdminSubscriptionActionInput = z.input<typeof adminSubscriptionActionSchema>;

/** The agent picks a plan; the server prices it and decides how it applies. */
export const subscriptionCheckoutSchema = z.object({
  planId: z.uuid(),
});

export const subscriptionQuoteQuerySchema = z.object({
  planId: z.uuid(),
});

export const cancelSubscriptionSchema = z.object({
  /** END_OF_PERIOD keeps the plan until the paid term ends; IMMEDIATE ends it now (no refund). */
  mode: z.enum(['END_OF_PERIOD', 'IMMEDIATE']),
  reason: z.string().trim().max(500).optional(),
});
export type CancelSubscriptionInput = z.input<typeof cancelSubscriptionSchema>;

/** Subscription payment references. */
export const SUBSCRIPTION_REFERENCE = /^HHS-[0-9a-f]{24}$/;
