import { describe, expect, it } from 'vitest';

import { MODERATION, missingForSubmission, moderationTarget } from './property-lifecycle';
import { amenitySlug, propertySlug } from './slug';

const complete = {
  description: 'A bright, spacious apartment close to the waterfront and shops.',
  pricingPeriod: 'YEARLY' as const,
  addressLine: '1 Admiralty Way',
  city: 'Lekki',
  lga: 'Eti-Osa',
  state: 'Lagos',
  latitude: 6.44 as never,
  longitude: 3.47 as never,
  priceKobo: 500_000_000n,
  propertyType: 'APARTMENT' as const,
  listingType: 'RENT' as const,
  bedrooms: 3,
  bathrooms: 3,
  maxGuests: null,
  cleaningOption: 'CUSTOMER_MUST_CLEAN' as const,
};

describe('missingForSubmission', () => {
  it('is empty for a complete property with an image', () => {
    expect(missingForSubmission(complete, 1)).toEqual([]);
  });

  it('requires at least one image and a location', () => {
    expect(missingForSubmission({ ...complete, latitude: null }, 0)).toEqual([
      'location',
      'images',
    ]);
  });

  it('requires guest capacity for nightly stays', () => {
    expect(missingForSubmission({ ...complete, pricingPeriod: 'DAILY' }, 1)).toEqual(['maxGuests']);
  });

  it('does not require rooms for land or commercial listings', () => {
    const land = {
      ...complete,
      propertyType: 'LAND' as const,
      listingType: 'SALE' as const,
      pricingPeriod: 'SALE' as const,
      bedrooms: null,
      bathrooms: null,
      cleaningOption: null,
    };
    expect(missingForSubmission(land, 1)).toEqual([]);
  });
});

describe('moderation', () => {
  it('only approves or rejects properties awaiting review', () => {
    expect(MODERATION.APPROVE.from).toEqual(['PENDING_REVIEW']);
    expect(MODERATION.REJECT.from).toEqual(['PENDING_REVIEW']);
  });

  it('restores previously published listings straight to published', () => {
    expect(moderationTarget('RESTORE', { publishedAt: new Date() })).toBe('PUBLISHED');
    expect(moderationTarget('RESTORE', { publishedAt: null })).toBe('PENDING_REVIEW');
  });
});

describe('slugs', () => {
  it('builds readable, unique property slugs', () => {
    const slug = propertySlug('3-Bedroom Flat in Lekki Phase 1!');
    expect(slug).toMatch(/^3-bedroom-flat-in-lekki-phase-1-[0-9a-f]{6}$/);
    expect(propertySlug('Same title')).not.toBe(propertySlug('Same title'));
    expect(propertySlug('!!!')).toMatch(/^property-[0-9a-f]{6}$/);
  });

  it('builds amenity slugs', () => {
    expect(amenitySlug('Wi-Fi')).toBe('wi-fi');
    expect(amenitySlug('Air Conditioning')).toBe('air-conditioning');
  });
});
