import { describe, expect, it } from 'vitest';

import { propertySearchQuerySchema } from './property.js';

describe('property search query', () => {
  it('reads the special-offers filter and the discount sort', () => {
    expect(propertySearchQuerySchema.parse({ onOffer: 'true', sort: 'discount' })).toMatchObject({
      onOffer: true,
      sort: 'discount',
    });
    expect(propertySearchQuerySchema.parse({}).onOffer).toBeUndefined();
    expect(propertySearchQuerySchema.safeParse({ onOffer: 'false' }).success).toBe(false);
    expect(propertySearchQuerySchema.safeParse({ sort: 'cheapest' }).success).toBe(false);
  });
});
