import type {
  AgentEarningStatus,
  AgentServiceType,
  BookingStatus,
  CancelledBy,
  LedgerBucket,
  LedgerEntryType,
  PaymentStatus,
  RefundStatus,
  IdDocumentType,
  AmenityCategory,
  CleaningOption,
  ListingType,
  PricingPeriod,
  PropertyStatus,
  PropertyType,
} from '@havenhub/shared';

/**
 * Display labels. Kept in a plain (non-client) module so both Server and
 * Client Components can import the values.
 */
export const SERVICE_LABELS: Record<AgentServiceType, string> = {
  PROPERTY_OWNER: 'Property owner',
  LANDLORD: 'Landlord',
  REAL_ESTATE_AGENT: 'Real estate agent',
  HOTEL_OPERATOR: 'Hotel operator',
  EVENT_ORGANIZER: 'Event organiser',
  TOUR_OPERATOR: 'Tour operator',
  CLEANER: 'Cleaning services',
};

export const ID_DOCUMENT_LABELS: Record<IdDocumentType, string> = {
  NIN_SLIP: 'NIN slip',
  INTERNATIONAL_PASSPORT: 'International passport',
  DRIVERS_LICENSE: 'Driver’s licence',
  VOTERS_CARD: 'Voter’s card',
};

/** Names for the profile requirements the API reports as missing. */
export const PROFILE_FIELD_LABELS: Record<string, string> = {
  addressLine: 'street address',
  city: 'city',
  lga: 'LGA',
  state: 'state',
  identity: 'identity details',
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  APARTMENT: 'Apartment',
  SELF_CONTAINED: 'Self-contained',
  HOUSE: 'House',
  DUPLEX: 'Duplex',
  BUNGALOW: 'Bungalow',
  TERRACE: 'Terrace',
  PENTHOUSE: 'Penthouse',
  LAND: 'Land',
  SHOP: 'Shop',
  OFFICE: 'Office',
  WAREHOUSE: 'Warehouse',
};

export const LISTING_TYPE_LABELS: Record<ListingType, string> = {
  RENT: 'For rent',
  SALE: 'For sale',
};

export const PERIOD_LABELS: Record<PricingPeriod, string> = {
  DAILY: 'Per night',
  MONTHLY: 'Per month',
  YEARLY: 'Per year',
  SALE: 'Sale price',
};

/** Suffix shown after a price, e.g. "₦80,000 / night". */
export const PERIOD_SUFFIX: Record<PricingPeriod, string> = {
  DAILY: '/ night',
  MONTHLY: '/ month',
  YEARLY: '/ year',
  SALE: '',
};

export const CLEANING_LABELS: Record<CleaningOption, string> = {
  INCLUDED: 'Cleaning included',
  AVAILABLE_FOR_FEE: 'Cleaning available for a fee',
  CUSTOMER_MUST_CLEAN: 'Guests clean before leaving',
  NOT_AVAILABLE: 'No cleaning service',
};

export const AMENITY_CATEGORY_LABELS: Record<AmenityCategory, string> = {
  ESSENTIALS: 'Essentials',
  FEATURES: 'Features',
  SAFETY: 'Safety & security',
  HOSPITALITY: 'Food & hospitality',
};

export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'In review',
  PUBLISHED: 'Published',
  REJECTED: 'Changes requested',
  SUSPENDED: 'Suspended',
  ARCHIVED: 'Archived',
};

/** Field names the API reports in `missingForSubmission`. */
export const PROPERTY_FIELD_LABELS: Record<string, string> = {
  description: 'description',
  pricingPeriod: 'pricing period',
  priceKobo: 'price',
  addressLine: 'street address',
  city: 'city',
  lga: 'LGA',
  state: 'state',
  location: 'map location',
  bedrooms: 'bedrooms',
  bathrooms: 'bathrooms',
  maxGuests: 'guest capacity',
  cleaningOption: 'cleaning arrangement',
  images: 'at least one photo',
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  COMPLETED: 'Completed',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  SUCCESS: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  REQUESTED: 'Refund requested',
  PROCESSING: 'Refund processing',
  COMPLETED: 'Refunded',
  REJECTED: 'Refund rejected',
  FAILED: 'Refund failed',
};

export const EARNING_STATUS_LABELS: Record<AgentEarningStatus, string> = {
  PENDING: 'Pending',
  AVAILABLE: 'Payable',
  REVERSED: 'Reversed',
};

export const LEDGER_LABELS: Record<LedgerEntryType, string> = {
  PLATFORM_SERVICE_FEE: 'HavenHub service fee',
  PLATFORM_COMMISSION: 'HavenHub commission',
  VAT_PAYABLE: 'VAT (for remittance)',
  AGENT_RENT_PAYABLE: 'Agent rent payable',
  AGENT_CLEANING_PAYABLE: 'Agent cleaning payable',
  CAUTION_HELD: 'Caution deposit held',
  UNALLOCATED: 'Unallocated (owed back)',
};

export const LEDGER_BUCKET_LABELS: Record<LedgerBucket, string> = {
  REVENUE: 'HavenHub revenue',
  TAX_PAYABLE: 'Tax payable',
  AGENT_PAYABLE: 'Agent payable',
  CAUTION_HELD: 'Caution held',
  OWED_TO_CUSTOMER: 'Owed to customer',
};

export const CANCELLED_BY_LABELS: Record<CancelledBy, string> = {
  CUSTOMER: 'the customer',
  AGENT: 'the agent',
  ADMIN: 'HavenHub',
  SYSTEM: 'HavenHub',
};
