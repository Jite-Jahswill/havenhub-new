import type { PublicBadge } from '../schemas/badge.js';
import type { RatingSummary } from '../schemas/review.js';
import type {
  AmenityCategory,
  CleaningOption,
  ListingType,
  PricingPeriod,
  PropertyStatus,
  PropertyType,
  VideoProvider,
} from '../enums/property.js';

/** All money values are integer kobo. */

export interface AmenityView {
  id: string;
  slug: string;
  name: string;
  category: AmenityCategory;
  icon: string | null;
}

export interface AdminAmenityView extends AmenityView {
  isActive: boolean;
  sortOrder: number;
  propertyCount: number;
}

export interface PropertyImageView {
  id: string;
  /** Large rendition (max 2000px). */
  url: string;
  /** Small rendition for cards and thumbnails (max 640px). */
  thumbnailUrl: string;
  width: number;
  height: number;
  altText: string | null;
  isPrimary: boolean;
}

export interface PropertyVideoView {
  id: string;
  provider: VideoProvider;
  externalId: string;
  embedUrl: string;
  title: string | null;
}

/** Public agent summary attached to listings. Never contains contact or identity data. */
export interface ListingAgentView {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  verified: true;
  memberSince: string;
}

/** Compact public listing for cards, search results and map markers. */
export interface PropertyCard {
  id: string;
  slug: string;
  title: string;
  propertyType: PropertyType;
  listingType: ListingType;
  pricingPeriod: PricingPeriod;
  priceKobo: number;
  discountPercent: number | null;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  bedrooms: number | null;
  bathrooms: number | null;
  maxGuests: number | null;
  sizeSqm: number | null;
  coverImage: { url: string; thumbnailUrl: string; altText: string | null } | null;
  agent: { id: string; displayName: string; verified: true };
  /** Featured by its agent (within their plan's featured allowance). */
  featured: boolean;
  /** Published reviews; null until the first one. */
  rating: RatingSummary | null;
  /** Badges it holds now (given by HavenHub or earned). */
  badges: PublicBadge[];
  publishedAt: string;
}

export interface PropertySearchResult {
  items: PropertyCard[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Ids of results the signed-in customer has favourited. */
  favoriteIds: string[];
}

export interface PropertyDetail extends PropertyCard {
  /**
   * Sale listings: sales happen directly with the agent, never through
   * HavenHub. The notice is always shown with the agent's details; `contact`
   * is null for signed-out visitors. Null for rentals, or when administrators
   * have switched direct contact off.
   */
  saleContact: {
    disclaimer: string;
    contact: { phone: string | null; email: string } | null;
  } | null;
  description: string;
  addressLine: string;
  lga: string;
  country: string;
  toilets: number | null;
  parkingSpaces: number | null;
  furnished: boolean;
  serviced: boolean;
  currency: 'NGN';
  cautionFeeKobo: number | null;
  cleaningOption: CleaningOption | null;
  cleaningFeeKobo: number | null;
  availableFrom: string | null;
  images: PropertyImageView[];
  videos: PropertyVideoView[];
  amenities: AmenityView[];
  agent: ListingAgentView & { publishedPropertyCount: number };
  isFavorite: boolean;
  updatedAt: string;
}

/** The owning agent's full view, including moderation state. */
export interface AgentPropertyView {
  id: string;
  slug: string;
  status: PropertyStatus;
  moderationNote: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  title: string;
  description: string | null;
  propertyType: PropertyType;
  listingType: ListingType;
  pricingPeriod: PricingPeriod | null;
  addressLine: string | null;
  city: string | null;
  lga: string | null;
  state: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  sizeSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  toilets: number | null;
  maxGuests: number | null;
  parkingSpaces: number | null;
  furnished: boolean;
  serviced: boolean;
  priceKobo: number | null;
  currency: 'NGN';
  cautionFeeKobo: number | null;
  discountPercent: number | null;
  cleaningOption: CleaningOption | null;
  cleaningFeeKobo: number | null;
  availableFrom: string | null;
  amenityIds: string[];
  images: PropertyImageView[];
  videos: PropertyVideoView[];
  /** Fields still needed before the property can be submitted for review. */
  missingForSubmission: string[];
  stats: { views: number; favorites: number };
  /** Featured (counts against the plan's featured allowance). */
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPropertyListItem {
  id: string;
  slug: string;
  title: string;
  status: PropertyStatus;
  moderationNote: string | null;
  propertyType: PropertyType;
  listingType: ListingType;
  pricingPeriod: PricingPeriod | null;
  priceKobo: number | null;
  city: string | null;
  state: string | null;
  coverImage: { thumbnailUrl: string } | null;
  stats: { views: number; favorites: number };
  featured: boolean;
  updatedAt: string;
}

export interface AdminPropertyListItem {
  id: string;
  slug: string;
  title: string;
  status: PropertyStatus;
  propertyType: PropertyType;
  listingType: ListingType;
  pricingPeriod: PricingPeriod | null;
  priceKobo: number | null;
  city: string | null;
  state: string | null;
  agent: { id: string; displayName: string; email: string };
  coverImage: { thumbnailUrl: string } | null;
  submittedAt: string | null;
  updatedAt: string;
}

export interface AdminPropertyDetail extends AgentPropertyView {
  agent: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
    verificationStatus: string;
  };
  amenities: AmenityView[];
  reviewedAt: string | null;
}
