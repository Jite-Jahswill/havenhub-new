import { describe, expect, it } from 'vitest';

import { ENTITLEMENTS, EntitlementKey } from '../enums/subscription.js';
import {
  cancelSubscriptionSchema,
  createSubscriptionPlanSchema,
  updateSubscriptionPlanSchema,
} from './subscription.js';

const entitlements = Object.fromEntries(Object.values(EntitlementKey).map((k) => [k, 1]));
const plan = {
  name: 'Starter',
  priceKobo: 500_000,
  billingInterval: 'MONTHLY',
  rank: 1,
  entitlements,
};

describe('subscription plan schemas', () => {
  it('every entitlement has a definition; only the cleaning allowance is not enforced', () => {
    expect(ENTITLEMENTS.map((e) => e.key).sort()).toEqual(Object.values(EntitlementKey).sort());
    // §14: cleaners never pay to post, so CLEANING_SERVICE_COUNT is kept for future use only.
    expect(ENTITLEMENTS.filter((e) => !e.enforced).map((e) => e.key)).toEqual([
      'CLEANING_SERVICE_COUNT',
    ]);
  });

  it('accepts a valid plan; null means unlimited and 0 means not included', () => {
    const parsed = createSubscriptionPlanSchema.parse({
      ...plan,
      entitlements: { ...entitlements, STORAGE_MB: null, HOTEL_COUNT: 0 },
    });
    expect(parsed).toMatchObject({ status: 'ACTIVE', features: [] });
    expect(parsed.entitlements.STORAGE_MB).toBeNull();
  });

  it('requires every entitlement to be stated explicitly', () => {
    const { PROPERTY_COUNT: _missing, ...partial } = entitlements;
    expect(createSubscriptionPlanSchema.safeParse({ ...plan, entitlements: partial }).success).toBe(
      false,
    );
  });

  it.each([
    ['negative limit', { entitlements: { ...entitlements, PROPERTY_COUNT: -1 } }],
    ['fractional limit', { entitlements: { ...entitlements, PROPERTY_COUNT: 1.5 } }],
    ['free price', { priceKobo: 0 }],
    ['fractional kobo', { priceKobo: 100.5 }],
    ['unknown interval', { billingInterval: 'WEEKLY' }],
    ['bad slug', { slug: 'Has Spaces' }],
    ['archived on create', { status: 'ARCHIVED' }],
  ])('rejects %s', (_, override) => {
    expect(createSubscriptionPlanSchema.safeParse({ ...plan, ...override }).success).toBe(false);
  });

  it('updates are partial but never empty, and do not reset omitted fields', () => {
    expect(updateSubscriptionPlanSchema.safeParse({}).success).toBe(false);
    expect(updateSubscriptionPlanSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('cancellation states its mode', () => {
    expect(cancelSubscriptionSchema.safeParse({}).success).toBe(false);
    expect(cancelSubscriptionSchema.parse({ mode: 'END_OF_PERIOD' }).mode).toBe('END_OF_PERIOD');
  });
});
