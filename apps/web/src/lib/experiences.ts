import { formatKobo, type ExperienceKind } from '@havenhub/shared';

/** Public section of each kind (also the admin and agent tab slugs). */
export const KIND_SEGMENT: Record<ExperienceKind, string> = {
  EVENT: 'events',
  TOUR: 'tours',
  HOTEL: 'hotels',
  CLEANING: 'cleaning',
};

export const SEGMENT_KIND: Record<string, ExperienceKind> = {
  events: 'EVENT',
  tours: 'TOUR',
  hotels: 'HOTEL',
  cleaning: 'CLEANING',
};

export const experiencePath = (kind: ExperienceKind, slug: string) =>
  `/${KIND_SEGMENT[kind]}/${slug}`;

/** Field names the API reports in an experience's `missingForSubmission`. */
export const EXPERIENCE_FIELD_LABELS: Record<string, string> = {
  description: 'description (at least 30 characters)',
  city: 'city',
  state: 'state',
  addressLine: 'address',
  serviceAreas: 'at least one service area',
  startsAt: 'start date and time',
  endsAt: 'end date and time',
  startsAtInFuture: 'a start time in the future',
  category: 'tour category',
  roomTypes: 'at least one room type',
  images: 'at least one photo',
};

const MOMENT = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});
const TIME = new Intl.DateTimeFormat('en-NG', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});
const DAY_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });

/** "Sat, 14 Nov 2026, 6:00 pm – 11:00 pm" in Nigerian time. */
export function formatEventTime(startsAt: string, endsAt?: string | null): string {
  const start = new Date(startsAt);
  if (!endsAt) return MOMENT.format(start);
  const end = new Date(endsAt);
  const sameDay = DAY_KEY.format(start) === DAY_KEY.format(end);
  return `${MOMENT.format(start)} – ${sameDay ? TIME.format(end) : MOMENT.format(end)}`;
}

/**
 * `datetime-local` value (Nigerian wall time, which has no DST: UTC+1) for an
 * ISO instant, and back. The browser's own timezone is deliberately ignored.
 */
export function toLagosInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 3_600_000).toISOString().slice(0, 16);
}
export function fromLagosInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return `${value}:00+01:00`;
}

/** A destination's indicative price range for display. */
export const priceRange = (min: number | null, max: number | null) =>
  min !== null && max !== null
    ? `${formatKobo(min)} – ${formatKobo(max)}`
    : min !== null
      ? `From ${formatKobo(min)}`
      : max !== null
        ? `Up to ${formatKobo(max)}`
        : null;
