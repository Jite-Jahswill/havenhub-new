import { z } from 'zod';

import {
  EXPERIENCE_LIMITS,
  ExperienceKind,
  ExperienceStatus,
  TicketTypeKind,
  TourCategory,
  Weekday,
} from '../enums/experience.js';
import { paginationQuerySchema } from './admin.js';
import { MAX_PRICE_KOBO, NIGERIA_BOUNDS, adminModeratePropertySchema } from './property.js';

/**
 * Events & experiences (Phase 6) — catalogue only. Every price here is a
 * listed price in integer kobo for display; nothing is charged.
 */

const kobo = z.number().int('Amounts are whole kobo').min(0).max(MAX_PRICE_KOBO);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
/** Free text that may be cleared: blank becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
/** Drops case-insensitive repeats, keeping the first spelling. */
const uniqueText = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    return seen.has(key) ? false : (seen.add(key), true);
  });
};
const uniqueBy = <T>(items: T[], key: (item: T) => string) =>
  new Set(items.map(key)).size === items.length;

/** Fields every kind shares. Drafts may leave everything but the title empty. */
const commonFields = {
  description: text(30, 5000).nullable().optional(),
  /** "X% off" shown on the listing; null removes it. */
  discountPercent: z.number().int().min(1).max(90).nullable().optional(),
  addressLine: text(3, 240).nullable().optional(),
  city: text(2, 100).nullable().optional(),
  state: text(2, 60).nullable().optional(),
  latitude: z.number().min(NIGERIA_BOUNDS.minLat).max(NIGERIA_BOUNDS.maxLat).nullable().optional(),
  longitude: z.number().min(NIGERIA_BOUNDS.minLng).max(NIGERIA_BOUNDS.maxLng).nullable().optional(),
  amenityIds: z
    .array(z.uuid())
    .max(60)
    .transform((ids) => [...new Set(ids)])
    .optional(),
};
const titleField = text(5, 120);

/** §22. Start and end are ISO instants; the web shows them in Nigerian time. */
export const eventDetailsSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    capacity: z.number().int().min(1).max(1_000_000).nullable(),
    organizer: optionalText(160),
    terms: optionalText(5000),
    hospitality: optionalText(2000),
  })
  .partial()
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), {
    path: ['endsAt'],
    message: 'The event must end after it starts',
  });

/** §24. `priceNote` says what the listed price covers, e.g. "per person". */
export const tourDetailsSchema = z
  .object({
    category: z.enum(TourCategory).nullable(),
    priceKobo: kobo.nullable(),
    priceNote: optionalText(120),
    capacity: z.number().int().min(1).max(100_000).nullable(),
  })
  .partial();

/** §25. */
export const hotelDetailsSchema = z
  .object({
    hospitality: optionalText(2000),
    food: optionalText(2000),
    cleaning: optionalText(2000),
  })
  .partial();

/** §14. */
export const cleaningDetailsSchema = z
  .object({
    priceKobo: kobo.nullable(),
    priceNote: optionalText(120),
    serviceAreas: z.array(text(2, 100)).max(EXPERIENCE_LIMITS.serviceAreas).transform(uniqueText),
    availableDays: z
      .array(z.enum(Weekday))
      .max(7)
      .transform((days) => [...new Set(days)]),
    availabilityNote: optionalText(300),
  })
  .partial();

const details = {
  event: eventDetailsSchema.optional(),
  tour: tourDetailsSchema.optional(),
  hotel: hotelDetailsSchema.optional(),
  cleaning: cleaningDetailsSchema.optional(),
};

const DETAIL_KEY = {
  EVENT: 'event',
  TOUR: 'tour',
  HOTEL: 'hotel',
  CLEANING: 'cleaning',
} as const satisfies Record<ExperienceKind, keyof typeof details>;
export const experienceDetailKey = (kind: ExperienceKind) => DETAIL_KEY[kind];

/** Only the details block that matches the listing's kind may be sent. */
function onlyOwnDetails(kind: ExperienceKind | undefined) {
  return (value: Partial<Record<keyof typeof details, unknown>>, ctx: z.RefinementCtx) => {
    for (const key of Object.values(DETAIL_KEY)) {
      if (value[key] !== undefined && (!kind || DETAIL_KEY[kind] !== key)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `Not applicable to this listing`,
        });
      }
    }
  };
}

/** Creates a draft. Ownership always comes from the session, never the body. */
export const createExperienceSchema = z
  .object({ kind: z.enum(ExperienceKind), title: titleField, ...commonFields, ...details })
  .strict()
  .superRefine((v, ctx) => onlyOwnDetails(v.kind)(v, ctx));
export type CreateExperienceInput = z.input<typeof createExperienceSchema>;

/**
 * Updates content. The kind cannot change; the server rejects a details
 * block that does not match the listing's kind.
 */
export const updateExperienceSchema = z
  .object({ title: titleField.optional(), ...commonFields, ...details })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateExperienceInput = z.input<typeof updateExperienceSchema>;

export const updateExperienceImageSchema = z
  .object({
    altText: z.string().trim().max(200).nullable(),
    isPrimary: z.literal(true),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const reorderExperienceImagesSchema = z.object({
  imageIds: z
    .array(z.uuid())
    .min(1)
    .max(EXPERIENCE_LIMITS.images)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate image ids' }),
});

export const addExperienceVideoSchema = z.object({
  url: z.url().max(500),
  title: z.string().trim().max(120).optional(),
});

// ── Kind-specific catalogue data ──

export const ticketTypeSchema = z.object({
  kind: z.enum(TicketTypeKind),
  name: text(2, 80),
  description: optionalText(500),
  priceKobo: kobo,
});

/** Replaces the event's ticket types (catalogue definitions only — nothing is sold). */
export const replaceTicketTypesSchema = z.object({
  ticketTypes: z
    .array(ticketTypeSchema)
    .max(EXPERIENCE_LIMITS.ticketTypes)
    .refine((list) => uniqueBy(list, (t) => t.name.toLowerCase()), {
      message: 'Give each ticket type a different name',
    }),
});
export type ReplaceTicketTypesInput = z.input<typeof replaceTicketTypesSchema>;

/** Replaces the tour's upcoming dates. Past dates are kept as history. */
export const replaceTourDatesSchema = z.object({
  dates: z
    .array(z.iso.datetime({ offset: true }))
    .max(EXPERIENCE_LIMITS.tourDates)
    .transform((dates) => [...new Set(dates.map((d) => new Date(d).toISOString()))].sort()),
});
export type ReplaceTourDatesInput = z.input<typeof replaceTourDatesSchema>;

const roomTypeFields = {
  name: text(2, 80),
  description: optionalText(1000),
  maxGuests: z.number().int().min(1).max(50).nullable().optional(),
  /** Listed nightly price. */
  priceKobo: kobo,
};
export const createRoomTypeSchema = z.object(roomTypeFields).strict();
export type CreateRoomTypeInput = z.input<typeof createRoomTypeSchema>;
export const updateRoomTypeSchema = z
  .object(roomTypeFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const roomFields = {
  roomTypeId: z.uuid(),
  label: text(1, 40),
  /** Overrides the room type's nightly price for this room. */
  priceKobo: kobo.nullable().optional(),
  active: z.boolean().optional(),
};
export const createRoomSchema = z.object(roomFields).strict();
export type CreateRoomInput = z.input<typeof createRoomSchema>;
export const updateRoomSchema = z
  .object(roomFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const isoDate = z.iso.date();

/** A window of room availability to read (at most ~3 months). */
export const roomAvailabilityQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'End on or after the start date' })
  // Inclusive of both ends: at most 92 calendar days.
  .refine((v) => daysBetween(v.from, v.to) < 92, {
    path: ['to'],
    message: 'Choose at most 92 days',
  });

/**
 * Sets or clears date-specific overrides for one room. Dates without an
 * override follow the room's defaults (open, at its nightly price).
 */
export const updateRoomAvailabilitySchema = z
  .object({
    set: z
      .array(
        z.object({
          date: isoDate,
          available: z.boolean(),
          priceKobo: kobo.nullable().optional(),
        }),
      )
      .max(EXPERIENCE_LIMITS.availabilityDays)
      .default([]),
    clear: z.array(isoDate).max(EXPERIENCE_LIMITS.availabilityDays).default([]),
  })
  .refine((v) => v.set.length + v.clear.length > 0, { message: 'Nothing to update' })
  .refine(
    (v) => {
      const dates = [...v.set.map((s) => s.date), ...v.clear];
      return new Set(dates).size === dates.length;
    },
    { message: 'Each date may appear only once' },
  );
export type UpdateRoomAvailabilityInput = z.input<typeof updateRoomAvailabilitySchema>;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

// ── Discovery ──

/** `soonest` orders events by start time; other kinds ignore it. */
export const EXPERIENCE_SORTS = ['newest', 'soonest'] as const;
export type ExperienceSort = (typeof EXPERIENCE_SORTS)[number];

/** Public listing of one kind. Every filter maps to a real column. */
export const experienceSearchQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(ExperienceKind),
  pageSize: z.coerce.number().int().min(1).max(48).default(18),
  q: z.string().trim().max(100).optional(),
  state: z.string().trim().max(60).optional(),
  city: z.string().trim().max(100).optional(),
  /** Tours only. */
  category: z.enum(TourCategory).optional(),
  /** Events only: upcoming (default) or past. */
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  /** Listings of one agent (public agent pages). */
  agent: z.uuid().optional(),
  sort: z.enum(EXPERIENCE_SORTS).default('newest'),
});
export type ExperienceSearchQuery = z.input<typeof experienceSearchQuerySchema>;
export type ExperienceSearchParams = z.output<typeof experienceSearchQuerySchema>;

export const agentListExperiencesQuerySchema = z.object({
  kind: z.enum(ExperienceKind).optional(),
});

export const adminListExperiencesQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(ExperienceKind).optional(),
  status: z.enum(ExperienceStatus).optional(),
  search: z.string().trim().max(120).optional(),
});
export type AdminListExperiencesQuery = z.input<typeof adminListExperiencesQuerySchema>;

/** The property moderation contract, unchanged: approve, reject, suspend, restore. */
export const adminModerateExperienceSchema = adminModeratePropertySchema;
export type AdminModerateExperienceInput = z.input<typeof adminModerateExperienceSchema>;

// ── Vacation zones (§23, admin-managed) ──

const listItems = z.array(text(2, 80)).max(EXPERIENCE_LIMITS.zoneListItems).transform(uniqueText);

const zoneFields = {
  name: text(2, 120),
  state: text(2, 60).nullable().optional(),
  description: text(1, 5000).nullable().optional(),
  accommodation: optionalText(2000),
  priceRangeMinKobo: kobo.nullable().optional(),
  priceRangeMaxKobo: kobo.nullable().optional(),
  activities: listItems.optional(),
  offers: optionalText(2000),
  hospitality: optionalText(2000),
  nearbyAttractions: listItems.optional(),
  published: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};

const priceRangeOk = (v: {
  priceRangeMinKobo?: number | null;
  priceRangeMaxKobo?: number | null;
}) =>
  v.priceRangeMinKobo == null ||
  v.priceRangeMaxKobo == null ||
  v.priceRangeMinKobo <= v.priceRangeMaxKobo;
const priceRangeIssue = {
  path: ['priceRangeMaxKobo'],
  message: 'The highest price must be at least the lowest',
};

export const createVacationZoneSchema = z
  .object(zoneFields)
  .strict()
  .refine(priceRangeOk, priceRangeIssue);
export type CreateVacationZoneInput = z.input<typeof createVacationZoneSchema>;

export const updateVacationZoneSchema = z
  .object(zoneFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .refine(priceRangeOk, priceRangeIssue);
export type UpdateVacationZoneInput = z.input<typeof updateVacationZoneSchema>;

/** Published tours and hotels featured in a destination, in display order. */
export const setZoneExperiencesSchema = z.object({
  experienceIds: z
    .array(z.uuid())
    .max(EXPERIENCE_LIMITS.zoneExperiences)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate listings' }),
});

export const vacationZoneListQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(48).default(18),
  state: z.string().trim().max(60).optional(),
});

export const adminListVacationZonesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
});
