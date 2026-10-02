import { Injectable } from '@nestjs/common';
import {
  ENTITLEMENTS,
  type EntitlementKey,
  type PlanEntitlements,
  type UsageItem,
} from '@havenhub/shared';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  BYTES_PER_MB,
  COUNTED_EXPERIENCE_STATUSES,
  COUNTED_STATUSES,
  PlanLimitsService,
} from './plan-limits.service';

/**
 * Usage against plan allowances, always counted from the platform's own
 * records — never from anything a client sends. The cleaning-service
 * allowance is not enforced (§14) and reports `used: null`.
 */
@Injectable()
export class PlanUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: PlanLimitsService,
  ) {}

  async usage(agentProfileId: string, limits: PlanEntitlements): Promise<UsageItem[]> {
    const counted = { agentProfileId, status: { in: COUNTED_STATUSES } };
    const [properties, featured, images, videos, storage, experiences] = await Promise.all([
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
      this.limits.storedBytes(agentProfileId),
      this.prisma.experience.groupBy({
        by: ['kind'],
        where: { agentProfileId, status: { in: COUNTED_EXPERIENCE_STATUSES } },
        _count: { _all: true },
      }),
    ]);
    const ofKind = (kind: string) => experiences.find((e) => e.kind === kind)?._count._all ?? 0;
    const fullest = (rows: { _count: { _all: number } }[]) =>
      rows.reduce((max, r) => Math.max(max, r._count._all), 0);

    const used: Record<EntitlementKey, number | null> = {
      PROPERTY_COUNT: properties,
      IMAGES_PER_PROPERTY: fullest(images),
      VIDEOS_PER_PROPERTY: fullest(videos),
      FEATURED_PROPERTY_COUNT: featured,
      STORAGE_MB: Math.ceil((storage / BYTES_PER_MB) * 10) / 10,
      EVENT_COUNT: ofKind('EVENT'),
      TOUR_COUNT: ofKind('TOUR'),
      CLEANING_SERVICE_COUNT: null,
      HOTEL_COUNT: ofKind('HOTEL'),
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
