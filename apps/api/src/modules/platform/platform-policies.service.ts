import { Injectable, Logger } from '@nestjs/common';
import {
  EXPERIENCE_KINDS,
  POLICY_AREAS,
  POLICY_DEFAULTS,
  policyAreaSchema,
  type ExperienceKind,
  type PlatformPolicies,
} from '@havenhub/shared';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

const CACHE_KEY = 'platform:policies';
const CACHE_TTL_SECONDS = 30;

/**
 * Parses a stored policies document area by area. A value that no longer
 * validates (for example after a bound was tightened) falls back to that
 * area's defaults instead of breaking every request that reads policies.
 */
export function parsePolicies(stored: unknown, onInvalid?: (area: string) => void) {
  const doc = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries(
    POLICY_AREAS.map((area) => {
      const parsed = policyAreaSchema(area).safeParse(doc[area] ?? {});
      if (!parsed.success) onInvalid?.(area);
      return [area, parsed.success ? parsed.data : { ...POLICY_DEFAULTS[area] }];
    }),
  ) as PlatformPolicies;
}

/**
 * The admin-configurable platform policies, read wherever a rule is
 * enforced. Cached in Redis and rewritten on every change (like the
 * maintenance switch), so all API instances apply a change at once; without
 * Redis they are read from the database.
 */
@Injectable()
export class PlatformPoliciesService {
  private readonly logger = new Logger(PlatformPoliciesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async get(): Promise<PlatformPolicies> {
    try {
      const cached = await this.redis.client.get(CACHE_KEY);
      if (cached) return JSON.parse(cached) as PlatformPolicies;
    } catch {
      // Redis unavailable: use the database.
    }
    const policies = await this.load();
    // NX: never overwrite a value published by a concurrent change.
    this.redis.client
      .set(CACHE_KEY, JSON.stringify(policies), 'EX', CACHE_TTL_SECONDS, 'NX')
      .catch(() => undefined);
    return policies;
  }

  /** Experience kinds currently offered (the events policy). */
  async enabledExperienceKinds(): Promise<ExperienceKind[]> {
    const { events } = await this.get();
    return EXPERIENCE_KINDS.filter((kind) => events[kind]);
  }

  /** Call after a committed change. */
  async publish(): Promise<void> {
    const policies = await this.load();
    try {
      await this.redis.client.set(CACHE_KEY, JSON.stringify(policies), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      // Instances fall back to the database once the cached value expires.
      this.logger.warn(`Platform policies not published: ${(error as Error).message}`);
      await this.redis.client.del(CACHE_KEY).catch(() => undefined);
    }
  }

  private async load(): Promise<PlatformPolicies> {
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: 1 },
      select: { policies: true },
    });
    return parsePolicies(row?.policies, (area) =>
      this.logger.warn(`Stored "${area}" policies are invalid; using the defaults for that area`),
    );
  }
}
