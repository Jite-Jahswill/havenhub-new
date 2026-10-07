import { describe, expect, it } from 'vitest';

import { POLICY_DEFAULTS, policyAreaSchema } from './platform-policies.js';
import { acceptSaleContactSchema, updatePropertySchema } from './property.js';

describe('property sales', () => {
  it('accepting the notice must be explicit and name the version seen', () => {
    const hash = 'a'.repeat(64);
    expect(
      acceptSaleContactSchema.safeParse({ accepted: true, disclaimerHash: hash }).success,
    ).toBe(true);
    expect(
      acceptSaleContactSchema.safeParse({ accepted: false, disclaimerHash: hash }).success,
    ).toBe(false);
    expect(acceptSaleContactSchema.safeParse({ accepted: true }).success).toBe(false);
    expect(acceptSaleContactSchema.safeParse({ accepted: true, disclaimerHash: 'x' }).success).toBe(
      false,
    );
  });

  it('sale mode is IN_APP or CONTACT', () => {
    expect(updatePropertySchema.safeParse({ saleMode: 'CONTACT' }).success).toBe(true);
    expect(updatePropertySchema.safeParse({ saleMode: 'AUCTION' }).success).toBe(false);
  });

  it('the sales policy defaults to contact allowed, with no notice until admins set one', () => {
    expect(POLICY_DEFAULTS.sales).toEqual({ contactEnabled: true, disclaimer: null });
    expect(policyAreaSchema('sales').parse({ disclaimer: '  Read me  ' })).toEqual({
      contactEnabled: true,
      disclaimer: 'Read me',
    });
    expect(policyAreaSchema('sales').safeParse({ disclaimer: 'x'.repeat(5001) }).success).toBe(
      false,
    );
  });
});
