import { describe, expect, it } from 'vitest';

import { EXPERIENCE_ENTITLEMENT } from '../enums/experience.js';
import {
  createExperienceSchema,
  createVacationZoneSchema,
  experienceSearchQuerySchema,
  replaceTicketTypesSchema,
  replaceTourDatesSchema,
  roomAvailabilityQuerySchema,
  updateExperienceSchema,
  updateRoomAvailabilitySchema,
} from './experience.js';

describe('experience schemas', () => {
  it('only cleaning services are exempt from a plan allowance', () => {
    expect(EXPERIENCE_ENTITLEMENT).toEqual({
      EVENT: 'EVENT_COUNT',
      TOUR: 'TOUR_COUNT',
      HOTEL: 'HOTEL_COUNT',
      CLEANING: null,
    });
  });

  it('creates need a kind and a title; unknown and foreign fields are rejected', () => {
    expect(createExperienceSchema.safeParse({ kind: 'EVENT', title: 'Jazz night' }).success).toBe(
      true,
    );
    expect(createExperienceSchema.safeParse({ title: 'Jazz night' }).success).toBe(false);
    for (const extra of [
      { agentProfileId: '00000000-0000-0000-0000-000000000000' },
      { status: 'PUBLISHED' },
      { hotel: {} },
    ]) {
      expect(
        createExperienceSchema.safeParse({ kind: 'EVENT', title: 'Jazz night', ...extra }).success,
      ).toBe(false);
    }
  });

  it('prices are whole, non-negative kobo', () => {
    const tour = (priceKobo: unknown) =>
      createExperienceSchema.safeParse({ kind: 'TOUR', title: 'City tour', tour: { priceKobo } })
        .success;
    expect(tour(0)).toBe(true);
    expect(tour(150_000)).toBe(true);
    expect(tour(-1)).toBe(false);
    expect(tour(1.5)).toBe(false);
    expect(tour('100')).toBe(false);
  });

  it('blank free text clears the field', () => {
    const parsed = updateExperienceSchema.parse({ event: { terms: '   ' } });
    expect(parsed.event?.terms).toBeNull();
  });

  it('ticket type names are unique (case-insensitive) and bounded', () => {
    const t = (name: string) => ({ kind: 'REGULAR', name, priceKobo: 100 });
    expect(
      replaceTicketTypesSchema.safeParse({ ticketTypes: [t('Regular'), t('VIP')] }).success,
    ).toBe(true);
    expect(
      replaceTicketTypesSchema.safeParse({ ticketTypes: [t('Regular'), t('regular')] }).success,
    ).toBe(false);
    expect(
      replaceTicketTypesSchema.safeParse({
        ticketTypes: Array.from({ length: 11 }, (_, i) => t(`T${i}`)),
      }).success,
    ).toBe(false);
  });

  it('tour dates are de-duplicated and sorted', () => {
    expect(
      replaceTourDatesSchema.parse({
        dates: ['2027-01-02T09:00:00+01:00', '2027-01-01T08:00:00Z', '2027-01-02T08:00:00Z'],
      }).dates,
    ).toEqual(['2027-01-01T08:00:00.000Z', '2027-01-02T08:00:00.000Z']);
  });

  it('availability windows and updates are bounded', () => {
    expect(
      roomAvailabilityQuerySchema.safeParse({ from: '2027-01-01', to: '2027-04-02' }).success,
    ).toBe(true);
    expect(
      roomAvailabilityQuerySchema.safeParse({ from: '2027-01-01', to: '2027-04-03' }).success,
    ).toBe(false);
    expect(
      roomAvailabilityQuerySchema.safeParse({ from: '2027-01-02', to: '2027-01-01' }).success,
    ).toBe(false);
    expect(updateRoomAvailabilitySchema.safeParse({}).success).toBe(false);
    expect(
      updateRoomAvailabilitySchema.safeParse({
        set: [{ date: '2027-01-01', available: false }],
        clear: ['2027-01-01'],
      }).success,
    ).toBe(false);
  });

  it('search requires a known kind and caps the page size', () => {
    expect(experienceSearchQuerySchema.safeParse({}).success).toBe(false);
    expect(experienceSearchQuerySchema.safeParse({ kind: 'HOTEL', pageSize: '500' }).success).toBe(
      false,
    );
    expect(experienceSearchQuerySchema.parse({ kind: 'EVENT' })).toMatchObject({
      when: 'upcoming',
      sort: 'newest',
      page: 1,
    });
  });

  it('a zone price range must be ordered', () => {
    expect(
      createVacationZoneSchema.safeParse({
        name: 'Obudu',
        priceRangeMinKobo: 10,
        priceRangeMaxKobo: 5,
      }).success,
    ).toBe(false);
  });
});
