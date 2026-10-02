import {
  videoEmbedUrl,
  type AgentPropertyListItem,
  type AgentPropertyView,
  type AmenityView,
  type PropertyCard,
  type PropertyImageView,
  type PropertyVideoView,
} from '@havenhub/shared';

import type { Amenity, PropertyImage, PropertyVideo } from '../../generated/prisma/client';
import type { StorageService } from '../../infrastructure/storage/storage.service';
import { missingForSubmission } from './property-lifecycle';
import { agentDisplayName, type AgentPropertyRow, type PropertyCardRow } from './property.selects';

type Urls = Pick<StorageService, 'url'>;

const num = (value: { toString(): string } | bigint | null): number | null =>
  value === null ? null : Number(value.toString());

const isoDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

export function toImageView(image: PropertyImage, urls: Urls): PropertyImageView {
  return {
    id: image.id,
    url: urls.url(image.storageKey),
    thumbnailUrl: urls.url(image.thumbnailKey),
    width: image.width,
    height: image.height,
    altText: image.altText,
    isPrimary: image.isPrimary,
  };
}

export function toVideoView(video: PropertyVideo): PropertyVideoView {
  return {
    id: video.id,
    provider: video.provider,
    externalId: video.externalId,
    embedUrl: videoEmbedUrl(video),
    title: video.title,
  };
}

export function toAmenityView(amenity: Amenity): AmenityView {
  return {
    id: amenity.id,
    slug: amenity.slug,
    name: amenity.name,
    category: amenity.category,
    icon: amenity.icon,
  };
}

/** Only ever called for publicly visible rows, whose required fields are guaranteed. */
export function toPropertyCard(row: PropertyCardRow, urls: Urls): PropertyCard {
  const cover = row.images[0];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    propertyType: row.propertyType,
    listingType: row.listingType,
    pricingPeriod: row.pricingPeriod!,
    priceKobo: num(row.priceKobo)!,
    discountPercent: row.discountPercent,
    city: row.city!,
    state: row.state!,
    latitude: num(row.latitude)!,
    longitude: num(row.longitude)!,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    maxGuests: row.maxGuests,
    sizeSqm: row.sizeSqm,
    coverImage: cover
      ? {
          url: urls.url(cover.storageKey),
          thumbnailUrl: urls.url(cover.thumbnailKey),
          altText: cover.altText,
        }
      : null,
    agent: {
      id: row.agentProfile.id,
      displayName: agentDisplayName(row.agentProfile),
      verified: true,
    },
    featured: row.featuredAt !== null,
    publishedAt: row.publishedAt!.toISOString(),
  };
}

export function toAgentPropertyView(
  row: AgentPropertyRow,
  views: number,
  urls: Urls,
): AgentPropertyView {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    moderationNote: row.moderationNote,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    title: row.title,
    description: row.description,
    propertyType: row.propertyType,
    listingType: row.listingType,
    pricingPeriod: row.pricingPeriod,
    addressLine: row.addressLine,
    city: row.city,
    lga: row.lga,
    state: row.state,
    country: row.country,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    sizeSqm: row.sizeSqm,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    toilets: row.toilets,
    maxGuests: row.maxGuests,
    parkingSpaces: row.parkingSpaces,
    furnished: row.furnished,
    serviced: row.serviced,
    priceKobo: num(row.priceKobo),
    currency: row.currency,
    cautionFeeKobo: num(row.cautionFeeKobo),
    discountPercent: row.discountPercent,
    cleaningOption: row.cleaningOption,
    cleaningFeeKobo: num(row.cleaningFeeKobo),
    availableFrom: isoDate(row.availableFrom),
    amenityIds: row.amenities.map((a) => a.amenityId),
    images: row.images.map((image) => toImageView(image, urls)),
    videos: row.videos.map(toVideoView),
    missingForSubmission: missingForSubmission(row, row.images.length),
    stats: { views, favorites: row._count.favorites },
    featured: row.featuredAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAgentPropertyListItem(
  row: Pick<
    AgentPropertyRow,
    | 'id'
    | 'slug'
    | 'title'
    | 'status'
    | 'moderationNote'
    | 'propertyType'
    | 'listingType'
    | 'pricingPeriod'
    | 'priceKobo'
    | 'city'
    | 'state'
    | 'updatedAt'
    | 'featuredAt'
  > & { images: { thumbnailKey: string }[]; _count: { favorites: number } },
  views: number,
  urls: Urls,
): AgentPropertyListItem {
  const cover = row.images[0];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    moderationNote: row.moderationNote,
    propertyType: row.propertyType,
    listingType: row.listingType,
    pricingPeriod: row.pricingPeriod,
    priceKobo: num(row.priceKobo),
    city: row.city,
    state: row.state,
    coverImage: cover ? { thumbnailUrl: urls.url(cover.thumbnailKey) } : null,
    stats: { views, favorites: row._count.favorites },
    featured: row.featuredAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { num };
