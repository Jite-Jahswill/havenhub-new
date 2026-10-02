import { Injectable } from '@nestjs/common';
import {
  ENTITLEMENTS,
  type EntitlementKey,
  type PlanEntitlements,
  type UsageItem,
} from '@havenhub/shared';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BYTES_PER_MB, COUNTED_STATUSES } from './plan-limits.service';

/**
 * Usage against plan allowances, always counted from the platform's own
 * records — never from anything a client sends. Allowances for features
 * HavenHub does not have yet (events, tours, hotels, cleaning) report
 * `used: null`; their modules plug into the same counts when they land.
 */
@Injectable()
export class PlanUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async usage(agentProfileId: string, limits: PlanEntitlements): Promise<UsageItem[]> {
    const counted = { agentProfileId, status: { in: COUNTED_STATUSES } };
    const [properties, featured, images, videos, storage] = await Promise.all([
      this.prisma.property.count({ where: counted }),
      this.prisma.property.count({ where: { ...counted, featuredAt: { not: null } } }),
      this.prisma.propertyImage.groupBy({
        by: ['propertyId'],
        where: { property: counted },
        _count: { _all: true },
      }),
      this.prisma.propertyVideo.groupBy({
        by: ['propertyId'],
        where: { property: counted },
        _count: { _all: true },
      }),
      this.prisma.propertyImage.aggregate({
        where: { property: { agentProfileId } },
        _sum: { bytes: true },
      }),
    ]);
    const fullest = (rows: { _count: { _all: number } }[]) =>
      rows.reduce((max, r) => Math.max(max, r._count._all), 0);

    const used: Record<EntitlementKey, number | null> = {
      PROPERTY_COUNT: properties,
      IMAGES_PER_PROPERTY: fullest(images),
      VIDEOS_PER_PROPERTY: fullest(videos),
      FEATURED_PROPERTY_COUNT: featured,
      STORAGE_MB: Math.ceil(((storage._sum.bytes ?? 0) / BYTES_PER_MB) * 10) / 10,
      EVENT_COUNT: null,
      TOUR_COUNT: null,
      CLEANING_SERVICE_COUNT: null,
      HOTEL_COUNT: null,
    };
    return ENTITLEMENTS.map((e) => ({
      key: e.key,
      label: e.label,
      scope: e.scope,
      unit: e.unit,
      used: used[e.key],
      limit: limits[e.key],
      enforced: e.enforced,
    }));
  }

  /** Allowances the agent currently exceeds (after a downgrade or a lowered limit). */
  static overLimit(usage: UsageItem[]): EntitlementKey[] {
    return usage
      .filter((u) => u.used !== null && u.limit !== null && u.used > u.limit)
      .map((u) => u.key);
  }
}
