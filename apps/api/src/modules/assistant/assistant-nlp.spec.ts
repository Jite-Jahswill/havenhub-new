import { NIGERIAN_STATES } from '@havenhub/shared';
import { describe, expect, it } from 'vitest';

import { amountToKobo, parseQuestion, type KnownPlaces } from './assistant-nlp';

const places: KnownPlaces = {
  states: NIGERIAN_STATES,
  cities: [
    { city: 'Lekki', state: 'Lagos' },
    { city: 'Port Harcourt', state: 'Rivers' },
    { city: 'Wuse', state: 'FCT' },
  ],
};
const ask = (text: string) => parseQuestion(text, places);
const naira = (n: number) => n * 100;

describe('assistant language understanding', () => {
  it('reads refund and booking status questions', () => {
    for (const q of [
      'whats my refund status',
      "What's my refund status?",
      'where is my refund',
      'has my refund been paid yet',
    ]) {
      expect(ask(q).intent, q).toBe('REFUND_STATUS');
    }
    expect(ask('how do refunds work').intent).toBe('FAQ');
    expect(ask('is my booking confirmed').intent).toBe('BOOKING_STATUS');
    expect(ask('did my payment go through').intent).toBe('BOOKING_STATUS');
    expect(ask('status of hh-7kq2m9xd please')).toMatchObject({
      intent: 'BOOKING_STATUS',
      bookingReference: 'HH-7KQ2M9XD',
    });
  });

  it('understands property searches with prices, places, rooms and types', () => {
    expect(ask('properties below 100k')).toMatchObject({
      intent: 'PROPERTY_SEARCH',
      property: { maxPriceKobo: naira(100_000) },
    });
    expect(ask('2 bedroom flat in Lekki under 3m a year').property).toMatchObject({
      propertyType: ['APARTMENT'],
      minBedrooms: 2,
      maxPriceKobo: naira(3_000_000),
      pricingPeriod: ['YEARLY'],
      listingType: 'RENT',
      place: { city: 'Lekki', state: 'Lagos' },
    });
    expect(ask('duplex for sale in Port Harcourt between 50m and 120m').property).toMatchObject({
      propertyType: ['DUPLEX'],
      listingType: 'SALE',
      minPriceKobo: naira(50_000_000),
      maxPriceKobo: naira(120_000_000),
      place: { city: 'Port Harcourt' },
    });
    expect(ask('shortlet in Abuja').property).toMatchObject({
      pricingPeriod: ['DAILY'],
      place: { state: 'FCT', label: 'Abuja' },
    });
    expect(ask('cheapest self contain in Lagos').property).toMatchObject({
      propertyType: ['SELF_CONTAINED'],
      sort: 'price_asc',
      place: { state: 'Lagos' },
    });
    expect(ask('three bedroom house from ₦250,000 per month').property).toMatchObject({
      propertyType: ['HOUSE'],
      minBedrooms: 3,
      minPriceKobo: naira(250_000),
      pricingPeriod: ['MONTHLY'],
    });
    expect(ask('apartments 100-200k').property).toMatchObject({
      minPriceKobo: naira(100_000),
      maxPriceKobo: naira(200_000),
    });
    expect(ask('show me properties with discounts').property).toMatchObject({ onOffer: true });
  });

  it('finds tours, events, hotels and cleaning by place', () => {
    expect(ask('best tour location in Uyo')).toMatchObject({
      intent: 'EXPERIENCE_SEARCH',
      experience: { kind: 'TOUR', place: { city: 'Uyo', state: 'Akwa Ibom' } },
    });
    expect(ask('any concerts this weekend in Lagos?').experience).toMatchObject({
      kind: 'EVENT',
      place: { state: 'Lagos' },
    });
    expect(ask('hotels in Akwa Ibom').experience).toMatchObject({
      kind: 'HOTEL',
      place: { state: 'Akwa Ibom' },
    });
    expect(ask('I need a cleaner in Wuse').experience).toMatchObject({
      kind: 'CLEANING',
      place: { city: 'Wuse' },
    });
    // A named property type wins: this is a property search.
    expect(ask('apartment near a hotel in Lekki').intent).toBe('PROPERTY_SEARCH');
  });

  it('hands over to a person when asked', () => {
    for (const q of [
      'I want to talk to a human',
      'speak with customer care',
      'can I chat with support',
      'connect me to a representative',
    ]) {
      expect(ask(q).intent, q).toBe('HANDOFF');
    }
  });

  it('handles small talk and falls back to the FAQ', () => {
    expect(ask('hello').intent).toBe('GREETING');
    expect(ask('thanks!').intent).toBe('THANKS');
    expect(ask('what can you do?').intent).toBe('CAPABILITIES');
    expect(ask('how do I verify my agent account').intent).toBe('FAQ');
    expect(ask('how do I verify my agent account').keywords).toEqual(
      expect.arrayContaining(['verify', 'agent', 'account']),
    );
  });

  it('does not mistake small numbers, dates or rooms for prices', () => {
    expect(ask('3 bedroom flat').property?.maxPriceKobo).toBeUndefined();
    expect(ask('apartment for 2 people').property?.minPriceKobo).toBeUndefined();
    expect(amountToKobo('1.5', 'm')).toBe(naira(1_500_000));
    expect(amountToKobo('250,000', undefined)).toBe(naira(250_000));
    expect(amountToKobo('0', 'k')).toBeNull();
  });
});
