import { ExperienceStatus, PropertyStatus } from '@havenhub/shared';
import { describe, expect, it } from 'vitest';

import { ExperienceStatus as DbExperienceStatus } from '../../generated/prisma/client';
import * as property from '../properties/property-lifecycle';
import * as experience from './experience-lifecycle';

const facts = (
  overrides: Partial<experience.SubmissionFacts> = {},
): experience.SubmissionFacts => ({
  kind: 'EVENT',
  description: 'A description that is long enough.',
  addressLine: '1 Marina',
  city: 'Lagos Island',
  state: 'Lagos',
  imageCount: 1,
  event: { startsAt: new Date('2027-01-01T18:00:00Z'), endsAt: new Date('2027-01-01T22:00:00Z') },
  tour: null,
  hotel: null,
  cleaning: null,
  ...overrides,
});

describe('experience lifecycle', () => {
  it('has exactly the property statuses, in the shared enum and the database', () => {
    expect(Object.values(ExperienceStatus)).toEqual(Object.values(PropertyStatus));
    expect(Object.values(DbExperienceStatus)).toEqual(Object.values(ExperienceStatus));
  });

  it('moderates exactly like properties', () => {
    expect(experience.MODERATION).toEqual(property.MODERATION);
    expect(experience.AGENT_EDITABLE).toEqual(property.AGENT_EDITABLE);
    expect(experience.AGENT_SUBMITTABLE).toEqual(property.AGENT_SUBMITTABLE);
    for (const action of ['APPROVE', 'REJECT', 'SUSPEND', 'RESTORE'] as const) {
      for (const publishedAt of [null, new Date()]) {
        expect(experience.moderationTarget(action, { publishedAt })).toBe(
          property.moderationTarget(action, { publishedAt }),
        );
      }
    }
  });

  it('a complete event is ready; a past one is not', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    expect(experience.missingForSubmission(facts(), now)).toEqual([]);
    expect(experience.missingForSubmission(facts(), new Date('2027-02-01T00:00:00Z'))).toEqual([
      'startsAtInFuture',
    ]);
    expect(
      experience.missingForSubmission(facts({ event: { startsAt: null, endsAt: null } }), now),
    ).toEqual(['startsAt', 'endsAt']);
  });

  it('kind-specific requirements', () => {
    expect(
      experience.missingForSubmission(
        facts({ kind: 'TOUR', event: null, tour: { category: null } }),
      ),
    ).toEqual(['category']);
    expect(
      experience.missingForSubmission(
        facts({ kind: 'HOTEL', event: null, hotel: { roomTypeCount: 0 }, imageCount: 0 }),
      ),
    ).toEqual(['roomTypes', 'images']);
    // Cleaning services describe service areas instead of one address.
    expect(
      experience.missingForSubmission(
        facts({ kind: 'CLEANING', event: null, addressLine: null, cleaning: { serviceAreas: [] } }),
      ),
    ).toEqual(['serviceAreas']);
  });
});
