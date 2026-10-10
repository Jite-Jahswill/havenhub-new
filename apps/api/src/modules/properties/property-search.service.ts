import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  AccountType,
  DEFAULT_SALES_DISCLAIMER,
  type PropertyCard,
  type PropertyDetail,
  type PropertySearchParams,
  type PropertySearchResult,
} from '@havenhub/shared';

import { Errors } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import type { AuthContext } from '../auth/auth.types';
import { num, toAmenityView, toImageView, toPropertyCard, toVideoView } from './property.mapper';
import {
  BADGE_AWARDS_SELECT,
  PROPERTY_CARD_SELECT,
  PUBLIC_PROPERTY_WHERE,
  agentDisplayName,
} from './property.selects';
import { PlatformPoliciesService } from '../platform/platform-policies.service';

const VIEW_DEDUPE_SECONDS = 30 * 60;

/**
 * Public discovery. Every query starts from PUBLIC_PROPERTY_WHERE, so drafts,
 * rejected, suspended and archived listings — and listings of unverified or
 * restricted agents — can never leak into search, detail or map results.
 */
@Injectable()
export class PropertySearchService {
  private readonly logger = new Logger(PropertySearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly policies: PlatformPoliciesService,
  ) {}

  async search(params: PropertySearchParams, viewer?: AuthContext): Promise<PropertySearchResult> {
    const where = buildWhere(params);
    const orderBy: Prisma.PropertyOrderByWithRelationInput[] =
      params.sort === 'price_asc'
        ? [{ priceKobo: 'asc' }, { id: 'asc' }]
        : params.sort === 'price_desc'
          ? [{ priceKobo: 'desc' }, { id: 'asc' }]
          : params.sort === 'discount'
            ? [
                { discountPercent: { sort: 'desc', nulls: 'last' } },
                { publishedAt: 'desc' },
                { id: 'asc' },
              ]
            : [{ publishedAt: 'desc' }, { id: 'asc' }];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.property.count({ where }),
      this.prisma.property.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: PROPERTY_CARD_SELECT,
      }),
    ]);
    const items = rows.map((row) => toPropertyCard(row, this.storage));
    return {
      items,
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.ceil(total / params.pageSize),
      favoriteIds: await this.favoriteIds(
        viewer,
        items.map((i) => i.id),
      ),
    };
  }

  async detail(slug: string, viewer?: AuthContext): Promise<PropertyDetail> {
    const row = await this.prisma.property.findFirst({
      where: { ...PUBLIC_PROPERTY_WHERE, slug },
      include: {
        images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        videos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        amenities: {
          where: { amenity: { isActive: true } },
          include: { amenity: true },
          orderBy: [{ amenity: { category: 'asc' } }, { amenity: { sortOrder: 'asc' } }],
        },
        agentProfile: {
          include: {
            user: {
              select: {
                fullName: true,
                avatarKey: true,
                createdAt: true,
                phone: true,
                email: true,
              },
            },
          },
        },
        badgeAwards: BADGE_AWARDS_SELECT,
      },
    });
    if (!row) throw Errors.notFound('Property');

    const [publishedPropertyCount, favoriteIds] = await Promise.all([
      this.prisma.property.count({
        where: { ...PUBLIC_PROPERTY_WHERE, agentProfileId: row.agentProfileId },
      }),
      this.favoriteIds(viewer, [row.id]),
    ]);
    const cover = row.images.find((i) => i.isPrimary) ?? row.images[0];
    const card: PropertyCard = toPropertyCard(
      { ...row, images: cover ? [cover] : [], agentProfile: row.agentProfile },
      this.storage,
    );

    const { sales } = await this.policies.get();
    // Sales are never processed on HavenHub: buyers deal with the agent directly,
    // under the notice. Contact details go to signed-in visitors only (no scraping).
    const saleContact =
      row.listingType === 'SALE' && sales.contactEnabled
        ? {
            disclaimer: sales.disclaimer ?? DEFAULT_SALES_DISCLAIMER,
            contact: viewer
              ? { phone: row.agentProfile.user.phone, email: row.agentProfile.user.email }
              : null,
          }
        : null;

    return {
      ...card,
      saleContact,
      description: row.description!,
      addressLine: row.addressLine!,
      lga: row.lga!,
      country: row.country,
      toilets: row.toilets,
      parkingSpaces: row.parkingSpaces,
      furnished: row.furnished,
      serviced: row.serviced,
      currency: row.currency,
      cautionFeeKobo: num(row.cautionFeeKobo),
      cleaningOption: row.cleaningOption,
      cleaningFeeKobo: num(row.cleaningFeeKobo),
      availableFrom: row.availableFrom ? row.availableFrom.toISOString().slice(0, 10) : null,
      images: row.images.map((image) => toImageView(image, this.storage)),
      videos: row.videos.map(toVideoView),
      amenities: row.amenities.map((pa) => toAmenityView(pa.amenity)),
      agent: {
        id: row.agentProfile.id,
        displayName: agentDisplayName(row.agentProfile),
        avatarUrl: this.storage.url(row.agentProfile.user.avatarKey),
        verified: true,
        memberSince: row.agentProfile.user.createdAt.toISOString(),
        publishedPropertyCount,
      },
      isFavorite: favoriteIds.includes(row.id),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Same listing type in the same city (falling back to the state). */
  async similar(slug: string, limit = 4): Promise<PropertyCard[]> {
    const base = await this.prisma.property.findFirst({
      where: { ...PUBLIC_PROPERTY_WHERE, slug },
      select: { id: true, listingType: true, city: true, state: true },
    });
    if (!base) throw Errors.notFound('Property');
    const rows = await this.prisma.property.findMany({
      where: {
        ...PUBLIC_PROPERTY_WHERE,
        id: { not: base.id },
        listingType: base.listingType,
        OR: [{ city: base.city }, { state: base.state }],
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: limit,
      select: PROPERTY_CARD_SELECT,
    });
    return rows.map((row) => toPropertyCard(row, this.storage));
  }

  /**
   * Counts a view at most once per visitor per 30 minutes. Only an
   * anonymous hash lives in Redis (briefly); the database stores daily totals.
   */
  async recordView(propertyId: string, visitor: string): Promise<void> {
    const visible = await this.prisma.property.count({
      where: { ...PUBLIC_PROPERTY_WHERE, id: propertyId },
    });
    if (!visible) throw Errors.notFound('Property');

    const fingerprint = createHash('sha256')
      .update(`${propertyId}|${visitor}`)
      .digest('hex')
      .slice(0, 32);
    try {
      const fresh = await this.redis.client.set(
        `pv:${fingerprint}`,
        '1',
        'EX',
        VIEW_DEDUPE_SECONDS,
        'NX',
      );
      if (fresh !== 'OK') return;
    } catch (error) {
      // Without de-duplication counts would inflate; skip rather than guess.
      this.logger.warn(`View not recorded (Redis unavailable): ${(error as Error).message}`);
      return;
    }
    const day = new Date(new Date().toISOString().slice(0, 10));
    await this.prisma.propertyViewDaily.upsert({
      where: { propertyId_day: { propertyId, day } },
      create: { propertyId, day, views: 1 },
      update: { views: { increment: 1 } },
    });
  }

  private async favoriteIds(viewer: AuthContext | undefined, ids: string[]): Promise<string[]> {
    if (!viewer || viewer.user.accountType !== AccountType.CUSTOMER || !ids.length) return [];
    const rows = await this.prisma.propertyFavorite.findMany({
      where: { userId: viewer.user.id, propertyId: { in: ids } },
      select: { propertyId: true },
    });
    return rows.map((r) => r.propertyId);
  }
}

export function buildWhere(params: PropertySearchParams): Prisma.PropertyWhereInput {
  const and: Prisma.PropertyWhereInput[] = [];
  const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

  if (params.q) {
    and.push({
      OR: [
        { title: contains(params.q) },
        { city: contains(params.q) },
        { lga: contains(params.q) },
        { state: contains(params.q) },
        { addressLine: contains(params.q) },
      ],
    });
  }
  if (params.state) and.push({ state: { equals: params.state, mode: 'insensitive' } });
  if (params.city) and.push({ city: { equals: params.city, mode: 'insensitive' } });
  if (params.agent) and.push({ agentProfileId: params.agent });
  if (params.propertyType?.length) and.push({ propertyType: { in: params.propertyType } });
  if (params.listingType) and.push({ listingType: params.listingType });
  if (params.pricingPeriod?.length) and.push({ pricingPeriod: { in: params.pricingPeriod } });
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    and.push({
      priceKobo: {
        ...(params.minPrice !== undefined ? { gte: BigInt(params.minPrice) } : {}),
        ...(params.maxPrice !== undefined ? { lte: BigInt(params.maxPrice) } : {}),
      },
    });
  }
  if (params.minBedrooms !== undefined) and.push({ bedrooms: { gte: params.minBedrooms } });
  if (params.minBathrooms !== undefined) and.push({ bathrooms: { gte: params.minBathrooms } });
  if (params.minGuests !== undefined) and.push({ maxGuests: { gte: params.minGuests } });
  if (params.furnished) and.push({ furnished: true });
  if (params.cleaningIncluded) and.push({ cleaningOption: 'INCLUDED' });
  if (params.onOffer) and.push({ discountPercent: { gte: 1 } });
  for (const slug of params.amenities ?? []) {
    and.push({ amenities: { some: { amenity: { slug, isActive: true } } } });
  }
  if (params.bbox) {
    and.push({
      latitude: { gte: params.bbox.south, lte: params.bbox.north },
      longitude: { gte: params.bbox.west, lte: params.bbox.east },
    });
  }
  return { ...PUBLIC_PROPERTY_WHERE, AND: and };
}
