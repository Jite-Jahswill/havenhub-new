/**
 * Money is always stored and transmitted as integer kobo (1 NGN = 100 kobo).
 * These helpers exist only for display and input conversion — final
 * financial values are always calculated by the API.
 */
export const KOBO_PER_NAIRA = 100;

export function nairaToKobo(naira: number): number {
  if (!Number.isFinite(naira)) {
    throw new RangeError('Amount must be a finite number');
  }
  return Math.round(naira * KOBO_PER_NAIRA);
}

export function formatKobo(kobo: number, locale = 'en-NG'): string {
  if (!Number.isInteger(kobo)) {
    throw new RangeError('Kobo amount must be an integer');
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: kobo % KOBO_PER_NAIRA === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(kobo / KOBO_PER_NAIRA);
}
