import { describe, expect, it } from 'vitest';

import { containsContactDetails } from './contact-details.js';

describe('containsContactDetails', () => {
  it('spots phone numbers however they are written', () => {
    for (const text of [
      'call me 08031234567',
      'my number is 0803 123 4567',
      '0803-123-4567 any time',
      '+234 803 123 4567',
      '+2348031234567',
      '(0803) 123.4567',
      'UK: +44 20 7946 0958',
    ]) {
      expect(containsContactDetails(text), text).toBe(true);
    }
  });

  it('spots emails and messaging links', () => {
    expect(containsContactDetails('write to ada.obi@example.com.ng')).toBe(true);
    expect(containsContactDetails('whatsapp https://wa.me/2348031234567')).toBe(true);
    expect(containsContactDetails('join t.me/lekkihomes')).toBe(true);
  });

  it('ignores ordinary messages, prices, dates and references', () => {
    for (const text of [
      'Is the apartment still available?',
      'The rent is ₦3,000,000 a year',
      'Can I check in on 2026-10-10 at 2pm?',
      'Booking HH-7K2Q9 for 3 nights, 2 guests',
      'Flat 12, 5 Admiralty Way',
      '',
      null,
    ]) {
      expect(containsContactDetails(text), String(text)).toBe(false);
    }
  });
});
