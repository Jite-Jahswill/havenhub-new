import { formatKobo, type BillingInterval, type PricingPeriod } from '@havenhub/shared';

import { PERIOD_SUFFIX } from './labels';

export function formatPrice(kobo: number, period?: PricingPeriod | null): string {
  const suffix = period ? PERIOD_SUFFIX[period] : '';
  return suffix ? `${formatKobo(kobo)} ${suffix}` : formatKobo(kobo);
}

/** Short form for map pins: ₦80k, ₦4.5m, ₦450m, ₦1.2b. */
export function formatCompactPrice(kobo: number): string {
  const naira = kobo / 100;
  const units: [number, string][] = [
    [1e9, 'b'],
    [1e6, 'm'],
    [1e3, 'k'],
  ];
  for (const [size, unit] of units) {
    if (naira >= size) {
      const value = naira / size;
      return `₦${value >= 100 ? Math.round(value) : Number(value.toFixed(1))}${unit}`;
    }
  }
  return `₦${Math.round(naira)}`;
}

export function discountedKobo(kobo: number, percent: number | null): number | null {
  return percent ? Math.round((kobo * (100 - percent)) / 100) : null;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Stay dates are calendar days (YYYY-MM-DD); format them in UTC so they never shift a day.
const DAY = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'UTC' });
const DAY_SHORT = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const MOMENT = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
});

export const formatDay = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));
export const formatStay = (start: string, end: string) =>
  `${DAY_SHORT.format(new Date(`${start}T00:00:00Z`))} – ${formatDay(end)}`;
const DATE = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' });
/** The calendar date of a timestamp in Nigerian time (subscription terms). */
export const formatDate = (iso: string) => DATE.format(new Date(iso));
/** Timestamps (payments, holds) in Nigerian time. */
export const formatMoment = (iso: string) => MOMENT.format(new Date(iso));

/** Basis points as a percentage: 750 → "7.5%". */
export const formatRate = (bps: number) => `${bps / 100}%`;

const PER: Record<BillingInterval, string> = { MONTHLY: 'month', YEARLY: 'year' };

/** "₦5,000 / month", or "Free" for the default plan. */
export const formatPlanPrice = (kobo: number, interval: BillingInterval | null) =>
  interval === null || kobo === 0 ? 'Free' : `${formatKobo(kobo)} / ${PER[interval]}`;

/** A plan limit for people: null = unlimited, 0 = not included. */
export function formatLimit(limit: number | null, unit: 'count' | 'MB' = 'count'): string {
  if (limit === null) return 'Unlimited';
  if (limit === 0) return 'Not included';
  if (unit === 'MB') return limit >= 1024 ? `${+(limit / 1024).toFixed(1)} GB` : `${limit} MB`;
  return limit.toLocaleString('en-NG');
}
