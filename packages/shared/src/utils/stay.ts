import type { PricingPeriod } from '../enums/property.js';

/**
 * Calendar arithmetic for stays. Dates are ISO `YYYY-MM-DD` strings in the
 * property's local calendar (Nigeria, WAT); stays are half-open ranges
 * [startDate, endDate) — the end date is the check-out day.
 */

export type RentalPeriod = Exclude<PricingPeriod, 'SALE'>;

/** How many units (nights / months / years) one booking may cover. */
export const STAY_LIMITS: Record<RentalPeriod, { min: number; max: number; unit: string }> = {
  DAILY: { min: 1, max: 90, unit: 'night' },
  MONTHLY: { min: 1, max: 24, unit: 'month' },
  YEARLY: { min: 1, max: 5, unit: 'year' },
};

/** The furthest ahead a stay may ever start; the booking policy may set less. */
export const MAX_ADVANCE_BOOKING_DAYS = 730;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(iso: string): Date {
  if (!ISO_DATE.test(iso)) throw new RangeError(`Invalid date: ${iso}`);
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new RangeError(`Invalid date: ${iso}`);
  }
  return date;
}

export const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Adds calendar months, clamping to the last day of shorter months (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const date = parseIsoDate(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

/** Check-out date for a stay of `quantity` units starting on `startDate`. */
export function stayEndDate(startDate: string, period: RentalPeriod, quantity: number): string {
  switch (period) {
    case 'DAILY':
      return addDays(startDate, quantity);
    case 'MONTHLY':
      return addMonths(startDate, quantity);
    case 'YEARLY':
      return addMonths(startDate, quantity * 12);
  }
}

/** Today's date in Nigeria (WAT, UTC+1, no daylight saving). */
export function todayInNigeria(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export const stayUnitLabel = (period: RentalPeriod, quantity: number): string => {
  const unit = STAY_LIMITS[period].unit;
  return `${quantity} ${quantity === 1 ? unit : `${unit}s`}`;
};
