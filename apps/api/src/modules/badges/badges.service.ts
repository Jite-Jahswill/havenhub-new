import { Injectable } from '@nestjs/common';
import {
  ratingSummary,
  type AdminBadgeDetail,
  type AdminBadgeView,
  type BadgeMode,
  type createBadgeSchema,
  type updateBadgeSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { Prisma, type Badge, type CmsMedia } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { CmsCacheService } from '../cms/cms-cache.service';
import { assertMediaExists, toCmsImage, validationError } from '../cms/cms-helpers';

type Db = PrismaService | Prisma.TransactionClient;
type Out<T extends z.ZodType> = z.output<T>;

/**
 * SQL form of `qualifiesForBadge` (shared): every rule that is set must hold;
 * a rating rule needs a review, and compares sums so 4.75 never passes 4.8.
 */
const QUALIFIES = Prisma.sql`
  (b.min_rating IS NULL OR (p.review_count > 0 AND p.rating_sum >= b.min_rating * p.review_count))
  AND (b.min_reviews IS NULL OR p.review_count >= b.min_reviews)
  AND (b.min_completed_bookings IS NULL OR p.completed_bookings >= b.min_completed_bookings)`;

/**
 * Badges: designed by administrators, given by hand (MANUAL) or earned
 * (AUTOMATIC). Earned badges live in `badge_awards` like given ones, so every
 * property card shows them with one join; `recompute` keeps them current and
 * is called wherever the inputs change (reviews, completed stays, rules).
 */
@Injectable()
export class BadgesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cms: CmsCacheService,
  ) {}

  /**
   * Brings AUTOMATIC awards in line with the rules, for some properties
   * and/or badges (both optional). Given (MANUAL) awards are never touched.
   */
  async recompute(
    db: Db,
    scope: { propertyIds?: string[]; badgeIds?: string[] } = {},
  ): Promise<void> {
    const filters = [
      scope.propertyIds ? Prisma.sql`AND p.id = ANY(${scope.propertyIds}::uuid[])` : Prisma.empty,
      scope.badgeIds ? Prisma.sql`AND b.id = ANY(${scope.badgeIds}::uuid[])` : Prisma.empty,
    ];
    await db.$executeRaw`
      DELETE FROM badge_awards a USING badges b, properties p
      WHERE a.badge_id = b.id AND a.property_id = p.id AND a.source = 'AUTOMATIC'
        AND (NOT b.active OR b.mode <> 'AUTOMATIC' OR NOT (${QUALIFIES}))
        ${filters[0]} ${filters[1]}`;
    await db.$executeRaw`
      INSERT INTO badge_awards (badge_id, property_id, source, created_at)
      SELECT b.id, p.id, 'AUTOMATIC', now() FROM badges b CROSS JOIN properties p
      WHERE b.active AND b.mode = 'AUTOMATIC' AND ${QUALIFIES}
        ${filters[0]} ${filters[1]}
      ON CONFLICT (badge_id, property_id) DO NOTHING`;
  }

  // ── Administration ──

  async list(): Promise<AdminBadgeView[]> {
    const rows = await this.prisma.badge.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { image: true, _count: { select: { awards: true } } },
    });
    return rows.map((r) => this.view(r, r._count.awards));
  }

  async get(id: string): Promise<AdminBadgeDetail> {
    const row = await this.prisma.badge.findUnique({
      where: { id },
      include: { image: true, _count: { select: { awards: true } } },
    });
    if (!row) throw Errors.notFound('Badge');
    const awards = await this.prisma.badgeAward.findMany({
      where: { badgeId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        property: {
          select: {
            id: true,
            slug: true,
            title: true,
            ratingSum: true,
            reviewCount: true,
            completedBookings: true,
          },
        },
      },
    });
    return {
      ...this.view(row, row._count.awards),
      properties: awards.map((a) => ({
        id: a.property.id,
        slug: a.property.slug,
        title: a.property.title,
        source: a.source as BadgeMode,
        rating: ratingSummary(a.property.ratingSum, a.property.reviewCount),
        completedBookings: a.property.completedBookings,
      })),
    };
  }

  async create(
    actorId: string,
    input: Out<typeof createBadgeSchema>,
    meta: RequestMeta,
  ): Promise<AdminBadgeDetail> {
    const id = await this.prisma.$transaction(async (tx) => {
      await assertMediaExists(tx, input.imageId, 'imageId');
      const badge = await tx.badge.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          imageId: input.imageId,
          mode: input.mode,
          ...rules(input),
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await this.recompute(tx, { badgeIds: [badge.id] });
      await this.audit.record(
        {
          actorId,
          action: 'badge.created',
          resourceType: 'badge',
          resourceId: badge.id,
          after: snapshot(badge),
          meta,
        },
        tx,
      );
      return badge.id;
    });
    await this.cms.invalidate();
    return this.get(id);
  }

  async update(
    actorId: string,
    id: string,
    input: Out<typeof updateBadgeSchema>,
    meta: RequestMeta,
  ): Promise<AdminBadgeDetail> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.badge.findUnique({ where: { id } });
      if (!current) throw Errors.notFound('Badge');
      await assertMediaExists(tx, input.imageId, 'imageId');
      const merged = {
        mode: input.mode ?? current.mode,
        minRating: input.minRating !== undefined ? input.minRating : current.minRating,
        minReviews: input.minReviews !== undefined ? input.minReviews : current.minReviews,
        minCompletedBookings:
          input.minCompletedBookings !== undefined
            ? input.minCompletedBookings
            : current.minCompletedBookings,
      };
      if (
        merged.mode === 'AUTOMATIC' &&
        merged.minRating == null &&
        merged.minReviews == null &&
        merged.minCompletedBookings == null
      ) {
        throw validationError('minRating', 'An automatic badge needs at least one rule');
      }
      const updated = await tx.badge.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
          ...(input.mode !== undefined ? { mode: input.mode } : {}),
          ...rules(input),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });
      // Switching to MANUAL drops earned awards; given ones stay either way.
      await this.recompute(tx, { badgeIds: [id] });
      await this.audit.record(
        {
          actorId,
          action: 'badge.updated',
          resourceType: 'badge',
          resourceId: id,
          before: snapshot(current),
          after: snapshot(updated),
          meta,
        },
        tx,
      );
    });
    await this.cms.invalidate();
    return this.get(id);
  }

  async remove(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const badge = await tx.badge.findUnique({ where: { id } });
      if (!badge) throw Errors.notFound('Badge');
      // Awards go with it (cascade).
      await tx.badge.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'badge.deleted',
          resourceType: 'badge',
          resourceId: id,
          before: snapshot(badge),
          meta,
        },
        tx,
      );
    });
    await this.cms.invalidate();
    return { deleted: true };
  }

  /** Gives a badge to a property by hand; it stays until taken back. */
  async assign(
    actorId: string,
    badgeId: string,
    slug: string,
    meta: RequestMeta,
  ): Promise<AdminBadgeDetail> {
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.badge.count({ where: { id: badgeId } }))) throw Errors.notFound('Badge');
      const property = await tx.property.findUnique({ where: { slug }, select: { id: true } });
      if (!property) throw validationError('property', 'No property has that address');
      await tx.badgeAward.upsert({
        where: { badgeId_propertyId: { badgeId, propertyId: property.id } },
        create: { badgeId, propertyId: property.id, source: 'MANUAL', assignedById: actorId },
        update: { source: 'MANUAL', assignedById: actorId },
      });
      await this.audit.record(
        {
          actorId,
          action: 'badge.assigned',
          resourceType: 'badge',
          resourceId: badgeId,
          after: { propertyId: property.id },
          meta,
        },
        tx,
      );
    });
    await this.cms.invalidate();
    return this.get(badgeId);
  }

  /** Takes a given badge back; it is re-earned at once if the rules still hold. */
  async unassign(
    actorId: string,
    badgeId: string,
    propertyId: string,
    meta: RequestMeta,
  ): Promise<AdminBadgeDetail> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.badgeAward.deleteMany({
        where: { badgeId, propertyId, source: 'MANUAL' },
      });
      if (count === 0) throw Errors.notFound('Given badge');
      await this.recompute(tx, { badgeIds: [badgeId], propertyIds: [propertyId] });
      await this.audit.record(
        {
          actorId,
          action: 'badge.unassigned',
          resourceType: 'badge',
          resourceId: badgeId,
          before: { propertyId },
          meta,
        },
        tx,
      );
    });
    await this.cms.invalidate();
    return this.get(badgeId);
  }

  private view(row: Badge & { image: CmsMedia }, holders: number): AdminBadgeView {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      image: toCmsImage(row.image, this.storage),
      mode: row.mode as BadgeMode,
      minRating: row.minRating === null ? null : Number(row.minRating),
      minReviews: row.minReviews,
      minCompletedBookings: row.minCompletedBookings,
      active: row.active,
      sortOrder: row.sortOrder,
      holders,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Rule columns that were sent (undefined = unchanged). */
function rules(input: {
  minRating?: number | null;
  minReviews?: number | null;
  minCompletedBookings?: number | null;
}) {
  return {
    ...(input.minRating !== undefined
      ? { minRating: input.minRating === null ? null : new Prisma.Decimal(input.minRating) }
      : {}),
    ...(input.minReviews !== undefined ? { minReviews: input.minReviews } : {}),
    ...(input.minCompletedBookings !== undefined
      ? { minCompletedBookings: input.minCompletedBookings }
      : {}),
  };
}

const snapshot = (b: Badge) => ({
  name: b.name,
  mode: b.mode,
  imageId: b.imageId,
  minRating: b.minRating?.toString() ?? null,
  minReviews: b.minReviews,
  minCompletedBookings: b.minCompletedBookings,
  active: b.active,
});
