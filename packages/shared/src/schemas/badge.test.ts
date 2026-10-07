import { describe, expect, it } from 'vitest';

import { badgeAssignmentSchema, createBadgeSchema, qualifiesForBadge } from './badge.js';
import { ratingSummary, reviewAuthorName } from './review.js';

const rules = (r: Partial<Parameters<typeof qualifiesForBadge>[0]>) => ({
  minRating: null,
  minReviews: null,
  minCompletedBookings: null,
  ...r,
});
const stats = (ratingSum: number, reviewCount: number, completedBookings = 0) => ({
  ratingSum,
  reviewCount,
  completedBookings,
});

describe('badge rules', () => {
  it('"5 stars and lots of bookings": every rule must hold', () => {
    const award = rules({ minRating: 5, minCompletedBookings: 10 });
    expect(qualifiesForBadge(award, stats(50, 10, 10))).toBe(true);
    expect(qualifiesForBadge(award, stats(49, 10, 10))).toBe(false); // 4.9 stars
    expect(qualifiesForBadge(award, stats(50, 10, 9))).toBe(false); // not enough bookings
  });

  it('a rating rule needs at least one review, and compares exactly (not rounded)', () => {
    expect(qualifiesForBadge(rules({ minRating: 4 }), stats(0, 0))).toBe(false);
    // 4.75 average is below 4.8 even though it rounds to 4.8.
    expect(qualifiesForBadge(rules({ minRating: 4.8 }), stats(19, 4))).toBe(false);
    expect(qualifiesForBadge(rules({ minRating: 4.8 }), stats(24, 5))).toBe(true);
    expect(qualifiesForBadge(rules({ minReviews: 3 }), stats(6, 3))).toBe(true);
  });

  it('badges need an image; automatic ones need a rule; ratings use one decimal', () => {
    const base = { name: 'Award winning', imageId: '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' };
    expect(createBadgeSchema.safeParse({ ...base, mode: 'MANUAL' }).success).toBe(true);
    expect(createBadgeSchema.safeParse({ ...base, mode: 'AUTOMATIC' }).success).toBe(false);
    expect(
      createBadgeSchema.safeParse({ ...base, mode: 'AUTOMATIC', minRating: 4.85 }).success,
    ).toBe(false);
    expect(
      createBadgeSchema.safeParse({ ...base, mode: 'AUTOMATIC', minRating: 4.8 }).success,
    ).toBe(true);
    expect(createBadgeSchema.safeParse({ name: 'X1', mode: 'MANUAL' }).success).toBe(false);
  });

  it('assignments accept a property link or slug', () => {
    expect(
      badgeAssignmentSchema.parse({ property: 'https://havenhub.ng/properties/lekki-flat?x=1' })
        .property,
    ).toBe('lekki-flat');
  });
});

describe('review helpers', () => {
  it('summarise ratings to one decimal, or nothing without reviews', () => {
    expect(ratingSummary(0, 0)).toBeNull();
    expect(ratingSummary(14, 3)).toEqual({ average: 4.7, count: 3 });
  });

  it('show authors as first name and last initial', () => {
    expect(reviewAuthorName('Chiamaka Okafor')).toBe('Chiamaka O.');
    expect(reviewAuthorName('  Ada  ')).toBe('Ada');
    expect(reviewAuthorName('Kemi Ade Adebayo')).toBe('Kemi A.');
  });
});
