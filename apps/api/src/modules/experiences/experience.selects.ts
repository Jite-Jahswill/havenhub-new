import { AgentVerificationStatus, ExperienceStatus, UserStatus } from '@havenhub/shared';

import type { Prisma } from '../../generated/prisma/client';

/**
 * "Publicly visible", exactly as for properties: published, and owned by a
 * verified agent whose account is active.
 */
export const PUBLIC_EXPERIENCE_WHERE = {
  status: ExperienceStatus.PUBLISHED,
  agentProfile: {
    verificationStatus: AgentVerificationStatus.VERIFIED,
    user: { status: UserStatus.ACTIVE },
  },
} satisfies Prisma.ExperienceWhereInput;

const ordered = {
  orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
};

/** Just what a card needs. `now` selects a tour's next date. */
export const experienceCardSelect = (now: Date) =>
  ({
    id: true,
    slug: true,
    kind: true,
    title: true,
    discountPercent: true,
    city: true,
    state: true,
    publishedAt: true,
    images: {
      where: { isPrimary: true },
      take: 1,
      select: { storageKey: true, thumbnailKey: true, altText: true },
    },
    agentProfile: {
      select: { id: true, businessName: true, user: { select: { fullName: true } } },
    },
    event: {
      select: { startsAt: true, endsAt: true, ticketTypes: { select: { priceKobo: true } } },
    },
    tour: {
      select: {
        category: true,
        priceKobo: true,
        priceNote: true,
        dates: {
          where: { startsAt: { gte: now } },
          orderBy: { startsAt: 'asc' },
          take: 1,
          select: { startsAt: true },
        },
      },
    },
    hotel: { select: { roomTypes: { select: { priceKobo: true } } } },
    cleaning: { select: { priceKobo: true, priceNote: true, serviceAreas: true } },
  }) satisfies Prisma.ExperienceSelect;

export type ExperienceCardRow = Prisma.ExperienceGetPayload<{
  select: ReturnType<typeof experienceCardSelect>;
}>;

/** Everything the owner (and the admin detail) sees. */
export const AGENT_EXPERIENCE_INCLUDE = {
  images: ordered,
  videos: ordered,
  amenities: { select: { amenityId: true } },
  event: { include: { ticketTypes: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } } },
  tour: { include: { dates: { orderBy: { startsAt: 'asc' } } } },
  hotel: {
    include: {
      roomTypes: {
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { rooms: { where: { active: true } } } } },
      },
      rooms: { orderBy: { label: 'asc' } },
    },
  },
  cleaning: true,
} satisfies Prisma.ExperienceInclude;

export type AgentExperienceRow = Prisma.ExperienceGetPayload<{
  include: typeof AGENT_EXPERIENCE_INCLUDE;
}>;
