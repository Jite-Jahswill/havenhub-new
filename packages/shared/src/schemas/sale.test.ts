import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SALES_DISCLAIMER,
  POLICY_DEFAULTS,
  policyAreaSchema,
} from './platform-policies.js';
import { updatePropertySchema } from './property.js';

describe('property sales', () => {
  it('listings have no sale mode: sales are never bought on HavenHub', () => {
    const parsed = updatePropertySchema.safeParse({ title: 'Four-bed duplex', saleMode: 'IN_APP' });
    expect(parsed.success && 'saleMode' in parsed.data).toBe(false);
  });

  it('the sales policy defaults to contact shown, with the standard notice', () => {
    expect(POLICY_DEFAULTS.sales).toEqual({ contactEnabled: true, disclaimer: null });
    expect(DEFAULT_SALES_DISCLAIMER).toMatch(/does not process property sales/);
    expect(policyAreaSchema('sales').parse({ disclaimer: '  Read me  ' })).toEqual({
      contactEnabled: true,
      disclaimer: 'Read me',
    });
    expect(policyAreaSchema('sales').safeParse({ disclaimer: 'x'.repeat(5001) }).success).toBe(
      false,
    );
  });
});
