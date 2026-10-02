import { Injectable } from '@nestjs/common';
import type {
  ExperienceDetail,
  ExperienceSearchParams,
  ExperienceSearchResult,
  HotelAvailabilityView,
  roomAvailabilityQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { num, toAmenityView } from '../properties/property.mapper';
import { agentDisplayName } from '../properties/property.selects';
import {
  toCleaningDetails,
  toEventDetails,
  toExperienceCard,
  toExperienceImageView,
  toExperienceVideoView,
  toHotelDetails,
  toTourDetails,
} from './experience.mapper';
import { PUBLIC_EXPERIENCE_WHERE, experienceCardSelect } from './experience.selects';

/**
 * Public discovery of events, tours, hotels and cleaning services. Every
 * query starts from PUBLIC_EXPERIENCE_WHERE, so unpublished listings and
 * listings of unverified or restricted agents never leak.
 */
@Injectable()
export class ExperienceSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async search(params: ExperienceSearchParams): Promise<ExperienceSearchResult> {
    const now = new Date();
    const where = buildWhere(params, now);
    const pastEvents = params.kind === 'EVENT' && params.when === 'past';
    const orderBy: Prisma.ExperienceOrderByWithRelationInput[] =
      params.kind === 'EVENT' && params.sort === 'soonest'
        ? [{ event: { startsAt: pastEvents ? 'desc' : 'asc' } }, { id: 'asc' }]
        : [{ publishedAt: 'desc' }, { id: 'asc' }];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.experience.count({ where }),
      this.prisma.experience.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: experienceCardSelect(now),
      }),
    ]);
    return {
      items: rows.map((row) => toExperienceCard(row, this.storage)),
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.ceil(total / params.pageSize),
    };
  }

  async detail(slug: string): Promise<ExperienceDetail> {
    const now = new Date();
    const ordered = { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] };
    const row = await this.prisma.experience.findFirst({
      where: { ...PUBLIC_EXPERIENCE_WHERE, slug },
      include: {
        images: ordered,
        videos: ordered,
        amenities: {
          where: { amenity: { isActive: true } },
          include: { amenity: true },
          orderBy: [{ amenity: { category: 'asc' } }, { amenity: { sortOrder: 'asc' } }],
        },
        event: { include: { ticketTypes: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } } },
        // The public sees only upcoming tour dates.
        tour: {
          include: { dates: { where: { startsAt: { gte: now } }, orderBy: { startsAt: 'asc' } } },
        },
        hotel: {
          include: {
            roomTypes: {
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              include: { _count: { select: { rooms: { where: { active: true } } } } },
            },
          },
        },
        cleaning: true,
        agentProfile: {
          include: { user: { select: { fullName: true, avatarKey: true, createdAt: true } } },
        },
      },
    });
    if (!row) throw Errors.notFound('Listing');

    const cover = row.images.find((i) => i.isPrimary) ?? row.images[0];
    const card = toExperienceCard(
      {
        ...row,
        images: cover ? [cover] : [],
        event: row.event,
        tour: row.tour,
        hotel: row.hotel,
        cleaning: row.cleaning,
      },
      this.storage,
    );
    return {
      ...card,
      description: row.description,
      addressLine: row.addressLine,
      latitude: num(row.latitude),
      longitude: num(row.longitude),
      images: row.images.map((i) => toExperienceImageView(i, this.storage)),
      videos: row.videos.map(toExperienceVideoView),
      amenities: row.amenities.map((a) => toAmenityView(a.amenity)),
      agent: {
        id: row.agentProfile.id,
        displayName: agentDisplayName(row.agentProfile),
        avatarUrl: this.storage.url(row.agentProfile.user.avatarKey),
        verified: true,
        memberSince: row.agentProfile.user.createdAt.toISOString(),
      },
      event: row.event ? toEventDetails(row.event) : null,
      tour: row.tour ? toTourDetails(row.tour) : null,
      hotel: row.hotel ? toHotelDetails(row.hotel) : null,
      cleaning: row.cleaning ? toCleaningDetails(row.cleaning) : null,
      purchasable: false,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * How many active rooms of each type are open on each date, and the
   * lowest listed nightly price among them. Room labels and individual
   * room states are not exposed publicly.
   */
  async hotelAvailability(
    slug: string,
    query: z.output<typeof roomAvailabilityQuerySchema>,
  ): Promise<HotelAvailabilityView> {
    const hotel = await this.prisma.experience.findFirst({
      where: { ...PUBLIC_EXPERIENCE_WHERE, slug, kind: 'HOTEL' },
      select: {
        hotel: {
          select: {
            roomTypes: {
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              select: {
                id: true,
                priceKobo: true,
                rooms: {
                  where: { active: true },
                  select: {
                    id: true,
                    priceKobo: true,
                    availability: {
                      where: { date: { gte: new Date(query.from), lte: new Date(query.to) } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!hotel?.hotel) throw Errors.notFound('Listing');

    const days: string[] = [];
    for (let d = new Date(query.from); d <= new Date(query.to); d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
    return {
      from: query.from,
      to: query.to,
      roomTypes: hotel.hotel.roomTypes.map((type) => ({
        roomTypeId: type.id,
        days: days.map((date) => {
          let availableRooms = 0;
          let min: bigint | null = null;
          for (const room of type.rooms) {
            const override = room.availability.find(
              (a) => a.date.toISOString().slice(0, 10) === date,
            );
            if (override && !override.available) continue;
            availableRooms += 1;
            const price = override?.priceKobo ?? room.priceKobo ?? type.priceKobo;
            if (min === null || price < min) min = price;
          }
          return { date, availableRooms, minPriceKobo: min === null ? null : Number(min) };
        }),
      })),
    };
  }
}

export function buildWhere(params: ExperienceSearchParams, now: Date): Prisma.ExperienceWhereInput {
  const and: Prisma.ExperienceWhereInput[] = [{ kind: params.kind }];
  const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
  if (params.q) {
    and.push({
      OR: [
        { title: contains(params.q) },
        { city: contains(params.q) },
        { state: contains(params.q) },
        { addressLine: contains(params.q) },
      ],
    });
  }
  if (params.state) and.push({ state: { equals: params.state, mode: 'insensitive' } });
  if (params.city) and.push({ city: { equals: params.city, mode: 'insensitive' } });
  if (params.agent) and.push({ agentProfileId: params.agent });
  if (params.kind === 'TOUR' && params.category) and.push({ tour: { category: params.category } });
  if (params.kind === 'EVENT') {
    and.push({
      event: params.when === 'past' ? { endsAt: { lt: now } } : { endsAt: { gte: now } },
    });
  }
  return { ...PUBLIC_EXPERIENCE_WHERE, AND: and };
}
