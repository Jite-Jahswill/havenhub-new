export const PropertyType = {
  APARTMENT: 'APARTMENT',
  SELF_CONTAINED: 'SELF_CONTAINED',
  HOUSE: 'HOUSE',
  DUPLEX: 'DUPLEX',
  BUNGALOW: 'BUNGALOW',
  TERRACE: 'TERRACE',
  PENTHOUSE: 'PENTHOUSE',
  LAND: 'LAND',
  SHOP: 'SHOP',
  OFFICE: 'OFFICE',
  WAREHOUSE: 'WAREHOUSE',
} as const;
export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];

/** Types without rooms; bedroom/bathroom/guest fields do not apply. */
export const NON_RESIDENTIAL_TYPES: readonly PropertyType[] = [
  'LAND',
  'SHOP',
  'OFFICE',
  'WAREHOUSE',
];

export const ListingType = {
  RENT: 'RENT',
  SALE: 'SALE',
} as const;
export type ListingType = (typeof ListingType)[keyof typeof ListingType];

export const PricingPeriod = {
  DAILY: 'DAILY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
  SALE: 'SALE',
} as const;
export type PricingPeriod = (typeof PricingPeriod)[keyof typeof PricingPeriod];

export const RENTAL_PERIODS: readonly PricingPeriod[] = ['DAILY', 'MONTHLY', 'YEARLY'];

/**
 * One lifecycle that includes moderation (spec §47). Only PUBLISHED
 * properties of verified, active agents are ever visible publicly.
 */
export const PropertyStatus = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type PropertyStatus = (typeof PropertyStatus)[keyof typeof PropertyStatus];

/** Spec §14. */
export const CleaningOption = {
  INCLUDED: 'INCLUDED',
  AVAILABLE_FOR_FEE: 'AVAILABLE_FOR_FEE',
  CUSTOMER_MUST_CLEAN: 'CUSTOMER_MUST_CLEAN',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
} as const;
export type CleaningOption = (typeof CleaningOption)[keyof typeof CleaningOption];

/** Admin-managed amenities are grouped by category; HOSPITALITY covers food and services (spec §15). */
export const AmenityCategory = {
  ESSENTIALS: 'ESSENTIALS',
  FEATURES: 'FEATURES',
  SAFETY: 'SAFETY',
  HOSPITALITY: 'HOSPITALITY',
} as const;
export type AmenityCategory = (typeof AmenityCategory)[keyof typeof AmenityCategory];

export const VideoProvider = {
  YOUTUBE: 'YOUTUBE',
  VIMEO: 'VIMEO',
} as const;
export type VideoProvider = (typeof VideoProvider)[keyof typeof VideoProvider];

export const Currency = { NGN: 'NGN' } as const;
export type Currency = (typeof Currency)[keyof typeof Currency];
