import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  daysBetween,
  parseIsoDate,
  stayEndDate,
  todayInNigeria,
} from './stay.js';

describe('stay dates', () => {
  it('daily stays end after N nights', () => {
    expect(stayEndDate('2026-12-30', 'DAILY', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('monthly stays clamp to the end of shorter months', () => {
    expect(stayEndDate('2027-01-31', 'MONTHLY', 1)).toBe('2027-02-28');
    expect(stayEndDate('2028-01-31', 'MONTHLY', 1)).toBe('2028-02-29');
    expect(stayEndDate('2027-03-15', 'MONTHLY', 12)).toBe('2028-03-15');
  });

  it('yearly stays handle leap days', () => {
    expect(stayEndDate('2027-06-01', 'YEARLY', 2)).toBe('2029-06-01');
    expect(stayEndDate('2028-02-29', 'YEARLY', 1)).toBe('2029-02-28');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addMonths('2027-11-30', 3)).toBe('2028-02-29');
  });

  it('rejects impossible dates', () => {
    expect(() => parseIsoDate('2027-02-30')).toThrow(RangeError);
    expect(() => parseIsoDate('27-1-1')).toThrow(RangeError);
  });

  it('uses the Nigerian calendar day', () => {
    // 23:30 UTC is already the next day in Lagos (UTC+1).
    expect(todayInNigeria(new Date('2027-03-01T23:30:00Z'))).toBe('2027-03-02');
    expect(todayInNigeria(new Date('2027-03-01T22:59:00Z'))).toBe('2027-03-01');
  });
});
