import { describe, expect, it } from 'vitest';

import {
  POLICY_AREA_META,
  POLICY_AREAS,
  POLICY_DEFAULTS,
  policyAreaSchema,
  updatePlatformPoliciesSchema,
} from './platform-policies.js';

describe('platform policies', () => {
  it('fill every missing value with its default, so an empty document is the built-in behaviour', () => {
    for (const area of POLICY_AREAS) {
      expect(policyAreaSchema(area).parse({})).toEqual(POLICY_DEFAULTS[area]);
    }
  });

  it('keep stored values, drop unknown keys and reject out-of-range values', () => {
    expect(policyAreaSchema('booking').parse({ maxOpenHoldsPerCustomer: 5, stale: 1 })).toEqual({
      ...POLICY_DEFAULTS.booking,
      maxOpenHoldsPerCustomer: 5,
    });
    expect(policyAreaSchema('security').safeParse({ passwordMinLength: 8 }).success).toBe(false);
  });

  it('accept partial updates of any area and refuse empty, unknown or invalid ones', () => {
    expect(updatePlatformPoliciesSchema.parse({ booking: { enabled: false }, chat: {} })).toEqual({
      booking: { enabled: false },
      chat: {},
    });
    expect(
      updatePlatformPoliciesSchema.safeParse({ security: { sessionDays: null } }).success,
    ).toBe(true);
    expect(updatePlatformPoliciesSchema.safeParse({}).success).toBe(false);
    expect(updatePlatformPoliciesSchema.safeParse({ chat: {} }).success).toBe(false);
    expect(updatePlatformPoliciesSchema.safeParse({ reviews: { on: true } }).success).toBe(false);
    expect(updatePlatformPoliciesSchema.safeParse({ booking: { nope: 1 } }).success).toBe(false);
    expect(updatePlatformPoliciesSchema.safeParse({ storage: { imageMaxMb: 11 } }).success).toBe(
      false,
    );
    expect(updatePlatformPoliciesSchema.safeParse({ booking: { holdMinutes: 2.5 } }).success).toBe(
      false,
    );
  });

  it('describe every field of every area for the admin form, with the schema bounds', () => {
    for (const area of POLICY_AREAS) {
      expect(POLICY_AREA_META[area].fields.map((f) => f.key).sort()).toEqual(
        Object.keys(POLICY_DEFAULTS[area]).sort(),
      );
    }
    const length = POLICY_AREA_META.security.fields.find((f) => f.key === 'passwordMinLength');
    expect(length).toMatchObject({ type: 'number', min: 10, max: 64 });
    const session = POLICY_AREA_META.security.fields.find((f) => f.key === 'sessionDays');
    expect(session).toMatchObject({ min: 1, max: 90, defaultLabel: 'Server default' });
  });
});
