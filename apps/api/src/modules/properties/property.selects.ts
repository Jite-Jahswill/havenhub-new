import { AgentVerificationStatus, PropertyStatus, UserStatus } from '@havenhub/shared';

import type { Prisma } from '../../generated/prisma/client';

/**
 * The single definition of "publicly visible": published, and owned by a
 * verified agent whose account is active. Suspending an agent therefore
 * hides all of their listings immediately, without touching the listings.
 */
export const PUBLIC_PROPERTY_WHERE = {
  status: PropertyStatus.PUBLISHED,
  agentProfile: {
    verificationStatus: AgentVerificationStatus.VERIFIED,
    user: { status: UserStatus.ACTIVE },
  },
} satisfies Prisma.PropertyWhereInput;

const agentSummary = {
  select: { id: true, businessName: true, user: { select: { fullName: true } } },
} satisfies Prisma.AgentProfileDefaultArgs;

/** Just what a card / map marker needs — no descriptions, no galleries. */
export const PROPERTY_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  propertyType: true,
  listingType: true,
  pricingPeriod: true,
  priceKobo: true,
  discountPercent: true,
  city: true,
  state: true,
  latitude: true,
  longitude: true,
  bedrooms: true,
  bathrooms: true,
  maxGuests: true,
  sizeSqm: true,
  publishedAt: true,
  featuredAt: true,
  images: {
    where: { isPrimary: true },
    take: 1,
    select: { storageKey: true, thumbnailKey: true, altText: true },
  },
  agentProfile: agentSummary,
} satisfies Prisma.PropertySelect;

export type PropertyCardRow = Prisma.PropertyGetPayload<{ select: typeof PROPERTY_CARD_SELECT }>;

export const PROPERTY_MEDIA_INCLUDE = {
  images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  videos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.PropertyInclude;

export const AGENT_PROPERTY_INCLUDE = {
  ...PROPERTY_MEDIA_INCLUDE,
  amenities: { select: { amenityId: true } },
  _count: { select: { favorites: true } },
} satisfies Prisma.PropertyInclude;

export type AgentPropertyRow = Prisma.PropertyGetPayload<{
  include: typeof AGENT_PROPERTY_INCLUDE;
}>;

export const agentDisplayName = (agent: {
  businessName: string | null;
  user: { fullName: string };
}) => agent.businessName ?? agent.user.fullName;
