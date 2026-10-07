import { z } from 'zod';

import {
  AmenityCategory,
  CleaningOption,
  ListingType,
  PricingPeriod,
  PropertyStatus,
  PropertyType,
  RENTAL_PERIODS,
  SaleMode,
} from '../enums/property.js';
import { paginationQuerySchema } from './admin.js';

/** Upper bound for any price: ₦10 trillion, comfortably within JS safe integers in kobo. */
export const MAX_PRICE_KOBO = 1_000_000_000_000_000;

const kobo = z.number().int('Amounts are whole kobo').min(0).max(MAX_PRICE_KOBO);
const count = (max: number) => z.number().int().min(0).max(max);

// Nigeria's bounding box (with a small margin): rejects swapped or foreign coordinates.
export const NIGERIA_BOUNDS = { minLat: 4, maxLat: 14, minLng: 2.6, maxLng: 14.7 } as const;

/** Every editable property field. Drafts may leave most of them empty. */
const propertyFields = {
  title: z.string().trim().min(5, 'Use at least 5 characters').max(120),
  description: z
    .string()
    .trim()
    .min(30, 'Describe the property in at least 30 characters')
    .max(5000),
  propertyType: z.enum(PropertyType),
  listingType: z.enum(ListingType),
  pricingPeriod: z.enum(PricingPeriod),
  /** Sale listings only; ignored for rentals. */
  saleMode: z.enum(SaleMode),

  addressLine: z.string().trim().min(3).max(240),
  city: z.string().trim().min(2).max(100),
  lga: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(60),
  country: z.literal('NG'),
  latitude: z.number().min(NIGERIA_BOUNDS.minLat).max(NIGERIA_BOUNDS.maxLat),
  longitude: z.number().min(NIGERIA_BOUNDS.minLng).max(NIGERIA_BOUNDS.maxLng),

  sizeSqm: z.number().int().min(1).max(10_000_000),
  bedrooms: count(50),
  bathrooms: count(50),
  toilets: count(50),
  maxGuests: z.number().int().min(1).max(200),
  parkingSpaces: count(500),
  furnished: z.boolean(),
  serviced: z.boolean(),

  priceKobo: kobo.min(100, 'Enter a price'),
  currency: z.literal('NGN'),
  cautionFeeKobo: kobo,
  /** Discount-ready: a display discount only; the discount engine arrives later. */
  discountPercent: z.number().int().min(1).max(90),
  cleaningOption: z.enum(CleaningOption),
  cleaningFeeKobo: kobo,
  availableFrom: z.iso.date(),

  amenityIds: z
    .array(z.uuid())
    .max(60)
    .transform((ids) => [...new Set(ids)]),
};

const f = propertyFields;

/** Fields that may be left empty while the property is a draft. */
const optionalShape = {
  description: f.description.nullable().optional(),
  pricingPeriod: f.pricingPeriod.nullable().optional(),
  addressLine: f.addressLine.nullable().optional(),
  city: f.city.nullable().optional(),
  lga: f.lga.nullable().optional(),
  state: f.state.nullable().optional(),
  country: propertyFields.country.optional(),
  latitude: f.latitude.nullable().optional(),
  longitude: f.longitude.nullable().optional(),
  sizeSqm: f.sizeSqm.nullable().optional(),
  bedrooms: f.bedrooms.nullable().optional(),
  bathrooms: f.bathrooms.nullable().optional(),
  toilets: f.toilets.nullable().optional(),
  maxGuests: f.maxGuests.nullable().optional(),
  parkingSpaces: f.parkingSpaces.nullable().optional(),
  furnished: propertyFields.furnished.optional(),
  serviced: propertyFields.serviced.optional(),
  priceKobo: f.priceKobo.nullable().optional(),
  currency: propertyFields.currency.optional(),
  cautionFeeKobo: f.cautionFeeKobo.nullable().optional(),
  discountPercent: f.discountPercent.nullable().optional(),
  cleaningOption: f.cleaningOption.nullable().optional(),
  cleaningFeeKobo: f.cleaningFeeKobo.nullable().optional(),
  availableFrom: f.availableFrom.nullable().optional(),
  amenityIds: propertyFields.amenityIds.optional(),
  saleMode: propertyFields.saleMode.optional(),
};

interface Consistency {
  listingType?: ListingType | null;
  pricingPeriod?: PricingPeriod | null;
  cleaningOption?: CleaningOption | null;
  cleaningFeeKobo?: number | null;
}

/** Cross-field rules that apply whenever both sides are present. */
function checkConsistency(value: Consistency, ctx: z.RefinementCtx) {
  if (value.listingType && value.pricingPeriod) {
    const ok =
      value.listingType === 'SALE'
        ? value.pricingPeriod === 'SALE'
        : RENTAL_PERIODS.includes(value.pricingPeriod);
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['pricingPeriod'],
        message:
          value.listingType === 'SALE'
            ? 'Properties for sale use the "sale" pricing period'
            : 'Choose daily, monthly or yearly for rentals',
      });
    }
  }
  if (value.cleaningOption === 'AVAILABLE_FOR_FEE' && !value.cleaningFeeKobo) {
    ctx.addIssue({ code: 'custom', path: ['cleaningFeeKobo'], message: 'Enter the cleaning fee' });
  }
}

/** Creating a property only needs the essentials; it starts as a draft. */
export const createPropertySchema = z
  .object({
    title: propertyFields.title,
    propertyType: propertyFields.propertyType,
    listingType: propertyFields.listingType,
    ...optionalShape,
  })
  .superRefine(checkConsistency);
export type CreatePropertyInput = z.input<typeof createPropertySchema>;

export const updatePropertySchema = z
  .object({
    title: propertyFields.title.optional(),
    propertyType: propertyFields.propertyType.optional(),
    listingType: propertyFields.listingType.optional(),
    ...optionalShape,
  })
  .superRefine(checkConsistency)
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdatePropertyInput = z.input<typeof updatePropertySchema>;

export const updatePropertyImageSchema = z
  .object({
    altText: z.string().trim().max(200).nullable(),
    isPrimary: z.literal(true),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const reorderPropertyImagesSchema = z.object({
  imageIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate image ids' }),
});

export const addPropertyVideoSchema = z.object({
  url: z.url().max(500),
  title: z.string().trim().max(120).optional(),
});

export const adminModeratePropertySchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'RESTORE']),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => !(v.action === 'REJECT' || v.action === 'SUSPEND') || Boolean(v.note), {
    path: ['note'],
    message: 'Give the agent a reason',
  });
export type AdminModeratePropertyInput = z.input<typeof adminModeratePropertySchema>;
export type ModerationAction = z.output<typeof adminModeratePropertySchema>['action'];

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item).max(30));

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    schema.optional(),
  );

export const PROPERTY_SORTS = ['newest', 'price_asc', 'price_desc', 'discount'] as const;
export type PropertySort = (typeof PROPERTY_SORTS)[number];

/** Public search. Every filter maps to a real, indexed column. */
export const propertySearchQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(48).default(18),
  q: z.string().trim().max(100).optional(),
  state: z.string().trim().max(60).optional(),
  city: z.string().trim().max(100).optional(),
  propertyType: csv(z.enum(PropertyType)).optional(),
  listingType: z.enum(ListingType).optional(),
  pricingPeriod: csv(z.enum(PricingPeriod)).optional(),
  minPrice: optionalNumber(z.number().int().min(0).max(MAX_PRICE_KOBO)),
  maxPrice: optionalNumber(z.number().int().min(0).max(MAX_PRICE_KOBO)),
  minBedrooms: optionalNumber(z.number().int().min(0).max(50)),
  minBathrooms: optionalNumber(z.number().int().min(0).max(50)),
  minGuests: optionalNumber(z.number().int().min(1).max(200)),
  furnished: z
    .enum(['true'])
    .transform(() => true)
    .optional(),
  cleaningIncluded: z
    .enum(['true'])
    .transform(() => true)
    .optional(),
  /** Only listings with a discount set by the agent ("special offers"). */
  onOffer: z
    .enum(['true'])
    .transform(() => true)
    .optional(),
  /** Amenity slugs; a property must have ALL of them. */
  amenities: csv(z.string().regex(/^[a-z0-9-]{2,60}$/)).optional(),
  /** Map viewport: west,south,east,north. */
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
    .transform((v) => {
      const [west, south, east, north] = v.split(',').map(Number) as [
        number,
        number,
        number,
        number,
      ];
      return { west, south, east, north };
    })
    .optional(),
  /** Listings of one agent (public agent profile pages). */
  agent: z.uuid().optional(),
  sort: z.enum(PROPERTY_SORTS).default('newest'),
});
export type PropertySearchQuery = z.input<typeof propertySearchQuerySchema>;
export type PropertySearchParams = z.output<typeof propertySearchQuerySchema>;

export const adminListPropertiesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(PropertyStatus).optional(),
});

export const amenityFields = {
  name: z.string().trim().min(2).max(60),
  category: z.enum(AmenityCategory),
  /** Optional icon name from the web app's icon set. */
  icon: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/)
    .nullable(),
  sortOrder: z.number().int().min(0).max(1000),
};

export const createAmenitySchema = z.object({
  ...amenityFields,
  icon: amenityFields.icon.optional(),
  sortOrder: amenityFields.sortOrder.optional(),
});
export type CreateAmenityInput = z.input<typeof createAmenitySchema>;

export const updateAmenitySchema = z
  .object({ ...amenityFields, isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateAmenityInput = z.input<typeof updateAmenitySchema>;

/** The buyer accepts the off-platform notice (the exact version they saw). */
export const acceptSaleContactSchema = z
  .object({
    accepted: z.literal(true, 'Tick that you accept the notice'),
    disclaimerHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type AcceptSaleContactInput = z.input<typeof acceptSaleContactSchema>;
