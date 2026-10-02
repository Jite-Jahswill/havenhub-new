import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AgentSubscriptionStatus,
  EXPERIENCE_ENTITLEMENT,
  ErrorCode,
  ExperienceStatus,
  PropertyStatus,
  entitlementDefinition,
  type ExperienceKind,
  type EntitlementKey,
  type PlanEntitlements,
} from '@havenhub/shared';

import { AppException } from '../../common/errors/app.exception';
import type {
  AgentSubscription,
  Prisma,
  SubscriptionPlan,
  SubscriptionPlanEntitlement,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { entitlementsOf } from './entitlements';
import { LimitNotifier } from './limit-notifier';

/** Archived properties do not count towards the property allowance. */
export const COUNTED_STATUSES = [
  PropertyStatus.DRAFT,
  PropertyStatus.PENDING_REVIEW,
  PropertyStatus.PUBLISHED,
  PropertyStatus.REJECTED,
  PropertyStatus.SUSPENDED,
];

/** Archived events, tours and hotels do not count towards their allowances. */
export const COUNTED_EXPERIENCE_STATUSES = [
  ExperienceStatus.DRAFT,
  ExperienceStatus.PENDING_REVIEW,
  ExperienceStatus.PUBLISHED,
  ExperienceStatus.REJECTED,
  ExperienceStatus.SUSPENDED,
];

export const BYTES_PER_MB = 1024 * 1024;

type Db = Prisma.TransactionClient | PrismaService;
type Tx = Prisma.TransactionClient;

export type PlanWithEntitlements = SubscriptionPlan & {
  entitlements: SubscriptionPlanEntitlement[];
};

export interface EffectivePlan {
  plan: PlanWithEntitlements;
  limits: PlanEntitlements;
  /** The paid term in force, or null on the free default plan. */
  subscription: AgentSubscription | null;
}

/**
 * The single place plan allowances are resolved and enforced (the
 * "subscription limit service"). Limits come from the database — the agent's
 * paid term in force, otherwise the admin-configured default plan — never
 * from code.
 *
 * Every `assert…` runs inside the caller's transaction after locking the
 * agent's row (then the property's, always in that order), so concurrent
 * requests cannot both slip under a limit.
 */
@Injectable()
export class PlanLimitsService {
  private readonly logger = new Logger(PlanLimitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: LimitNotifier,
  ) {}

  /**
   * The plan whose limits apply at `now`. A paid term counts while `now` is
   * inside its period — even before the sweep has flipped a scheduled term
   * to ACTIVE — so agents always get what they paid for, and never more.
   */
  async effectivePlan(agentProfileId: string, db: Db = this.prisma, now = new Date()) {
    const subscription = await db.agentSubscription.findFirst({
      where: {
        agentProfileId,
        status: { in: [AgentSubscriptionStatus.ACTIVE, AgentSubscriptionStatus.PENDING] },
        currentPeriodStart: { lte: now },
        currentPeriodEnd: { gt: now },
      },
      // Enum order is PENDING < ACTIVE: prefer the ACTIVE term if both overlap.
      orderBy: [{ status: 'desc' }, { currentPeriodStart: 'desc' }],
      include: { plan: { include: { entitlements: true } } },
    });
    if (subscription) {
      const { plan, ...term } = subscription;
      return { plan, limits: entitlementsOf(plan), subscription: term } satisfies EffectivePlan;
    }
    const plan = await this.defaultPlan(db);
    return { plan, limits: entitlementsOf(plan), subscription: null } satisfies EffectivePlan;
  }

  async defaultPlan(db: Db = this.prisma): Promise<PlanWithEntitlements> {
    const plan = await db.subscriptionPlan.findFirst({
      where: { isDefault: true },
      include: { entitlements: true },
    });
    if (!plan) {
      this.logger.error('No default subscription plan exists — run `pnpm db:seed`.');
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.PLANS_NOT_CONFIGURED,
        'Listing allowances are not configured yet. Please try again later.',
      );
    }
    return plan;
  }

  async assertCanAddProperty(tx: Tx, agentProfileId: string): Promise<void> {
    await lockAgent(tx, agentProfileId);
    const { plan, limits } = await this.effectivePlan(agentProfileId, tx);
    const used = await tx.property.count({
      where: { agentProfileId, status: { in: COUNTED_STATUSES } },
    });
    this.check(agentProfileId, plan, limits, 'PROPERTY_COUNT', used, 1);
  }

  /** `bytes`: size of the rendition about to be stored, for the storage allowance. */
  async assertCanAddImage(
    tx: Tx,
    agentProfileId: string,
    propertyId: string,
    bytes = 0,
  ): Promise<void> {
    await lockAgent(tx, agentProfileId);
    await lockProperty(tx, propertyId);
    const { plan, limits } = await this.effectivePlan(agentProfileId, tx);
    const used = await tx.propertyImage.count({ where: { propertyId } });
    this.check(agentProfileId, plan, limits, 'IMAGES_PER_PROPERTY', used, 1);
    if (limits.STORAGE_MB !== null) {
      const stored = await this.storedBytes(agentProfileId, tx);
      const allowed = limits.STORAGE_MB * BYTES_PER_MB;
      if (stored + bytes > allowed) {
        throw this.reached(agentProfileId, plan, 'STORAGE_MB', toMb(stored), limits.STORAGE_MB);
      }
    }
  }

  async assertCanAddVideo(tx: Tx, agentProfileId: string, propertyId: string): Promise<void> {
    await lockAgent(tx, agentProfileId);
    await lockProperty(tx, propertyId);
    const { plan, limits } = await this.effectivePlan(agentProfileId, tx);
    const used = await tx.propertyVideo.count({ where: { propertyId } });
    this.check(agentProfileId, plan, limits, 'VIDEOS_PER_PROPERTY', used, 1);
  }

  async assertCanFeature(tx: Tx, agentProfileId: string): Promise<void> {
    await lockAgent(tx, agentProfileId);
    const { plan, limits } = await this.effectivePlan(agentProfileId, tx);
    const used = await tx.property.count({
      where: { agentProfileId, featuredAt: { not: null }, status: { in: COUNTED_STATUSES } },
    });
    this.check(agentProfileId, plan, limits, 'FEATURED_PROPERTY_COUNT', used, 1);
  }

  /**
   * Generic check for allowances counted by later modules (events, tours,
   * hotels, cleaning services): they lock the agent, count their own rows
   * and call this before creating one.
   */
  async assertWithinAllowance(
    tx: Tx,
    agentProfileId: string,
    key: EntitlementKey,
    used: number,
  ): Promise<void> {
    await lockAgent(tx, agentProfileId);
    const { plan, limits } = await this.effectivePlan(agentProfileId, tx);
    this.check(agentProfileId, plan, limits, key, used, 1);
  }

  /**
   * Adding an event, tour or hotel (or restoring an archived one): checks the
   * kind's allowance against the agent's non-archived listings of that kind.
   * Cleaning services are never limited (§14) — only the agent is locked.
   */
  async assertCanAddExperience(tx: Tx, agentProfileId: string, kind: ExperienceKind) {
    await lockAgent(tx, agentProfileId);
    const key = EXPERIENCE_ENTITLEMENT[kind];
    if (!key) return;
    const used = await tx.experience.count({
      where: { agentProfileId, kind, status: { in: COUNTED_EXPERIENCE_STATUSES } },
    });
    await this.assertWithinAllowance(tx, agentProfileId, key, used);
  }

  /** Experience images share the agent's storage allowance with property images. */
  async assertStorageFor(tx: Tx, agentProfileId: string, bytes: number): Promise<void> {
    await lockAgent(tx, agentProfileId);
    const { plan, limits } = await this.effectivePlan(agentProfileId, tx);
    if (limits.STORAGE_MB === null) return;
    const stored = await this.storedBytes(agentProfileId, tx);
    if (stored + bytes > limits.STORAGE_MB * BYTES_PER_MB) {
      throw this.reached(agentProfileId, plan, 'STORAGE_MB', toMb(stored), limits.STORAGE_MB);
    }
  }

  /** Bytes of every stored listing image the agent owns (any status, any listing type). */
  async storedBytes(agentProfileId: string, db: Db = this.prisma): Promise<number> {
    const [properties, experiences] = await Promise.all([
      db.propertyImage.aggregate({
        where: { property: { agentProfileId } },
        _sum: { bytes: true },
      }),
      db.experienceImage.aggregate({
        where: { experience: { agentProfileId } },
        _sum: { bytes: true },
      }),
    ]);
    return (properties._sum.bytes ?? 0) + (experiences._sum.bytes ?? 0);
  }

  /**
   * Un-features the most recently featured listings beyond the agent's
   * current allowance (after a downgrade, expiry, suspension or a lowered
   * plan limit). Listings themselves are never hidden or removed.
   */
  async releaseExcessFeatured(tx: Tx, agentProfileId: string): Promise<string[]> {
    await lockAgent(tx, agentProfileId);
    const { limits } = await this.effectivePlan(agentProfileId, tx);
    const allowed = limits.FEATURED_PROPERTY_COUNT;
    if (allowed === null) return [];
    const featured = await tx.property.findMany({
      where: { agentProfileId, featuredAt: { not: null } },
      orderBy: { featuredAt: 'asc' },
      select: { id: true, status: true },
    });
    const holdsSlot = (status: string) => (COUNTED_STATUSES as string[]).includes(status);
    const counted = featured.filter((p) => holdsSlot(p.status));
    const release = [
      ...counted.slice(allowed).map((p) => p.id),
      // Archived listings never hold a slot.
      ...featured.filter((p) => !holdsSlot(p.status)).map((p) => p.id),
    ];
    if (release.length > 0) {
      await tx.property.updateMany({ where: { id: { in: release } }, data: { featuredAt: null } });
    }
    return release;
  }

  private check(
    agentProfileId: string,
    plan: PlanWithEntitlements,
    limits: PlanEntitlements,
    key: EntitlementKey,
    used: number,
    adding: number,
  ): void {
    const limit = limits[key];
    if (limit !== null && used + adding > limit) {
      throw this.reached(agentProfileId, plan, key, used, limit);
    }
  }

  private reached(
    agentProfileId: string,
    plan: PlanWithEntitlements,
    key: EntitlementKey,
    used: number,
    limit: number,
  ): AppException {
    this.notifier.limitReached(agentProfileId, key, plan.name, limit);
    return new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.PLAN_LIMIT_REACHED,
      limitMessage(key, plan.name, limit),
      { entitlement: key, limit, used, planName: plan.name, planId: plan.id },
    );
  }
}

export function limitMessage(key: EntitlementKey, planName: string, limit: number): string {
  const allows = `Your ${planName} plan allows`;
  switch (key) {
    case 'PROPERTY_COUNT':
      return `You have reached your property limit. ${allows} ${limit} active ${plural(limit, 'property', 'properties')}. Archive one or upgrade your plan to add more.`;
    case 'IMAGES_PER_PROPERTY':
      return `You have reached the image limit for this property. ${allows} ${limit} ${plural(limit, 'image', 'images')} per property. Upgrade your plan to add more.`;
    case 'VIDEOS_PER_PROPERTY':
      return `You have reached the video limit for this property. ${allows} ${limit} ${plural(limit, 'video', 'videos')} per property. Upgrade your plan to add more.`;
    case 'FEATURED_PROPERTY_COUNT':
      return limit === 0
        ? `Featured listings are not included in your ${planName} plan. Upgrade your plan to feature properties.`
        : `You have reached your featured listing limit. ${allows} ${limit} featured ${plural(limit, 'property', 'properties')}. Un-feature one or upgrade your plan.`;
    case 'STORAGE_MB':
      return `You have used your image storage. ${allows} ${limit} MB. Remove some images or upgrade your plan.`;
    case 'EVENT_COUNT':
      return listingMessage('event', 'events', allows, limit, planName);
    case 'TOUR_COUNT':
      return listingMessage('tour', 'tours', allows, limit, planName);
    case 'HOTEL_COUNT':
      return listingMessage('hotel listing', 'hotel listings', allows, limit, planName);
    default:
      return `${allows} ${limit} ${entitlementDefinition(key).label.toLowerCase()}. Upgrade your plan to add more.`;
  }
}

function listingMessage(one: string, many: string, allows: string, limit: number, plan: string) {
  return limit === 0
    ? `${many[0]!.toUpperCase()}${many.slice(1)} are not included in your ${plan} plan. Upgrade your plan to add ${many}.`
    : `You have reached your ${one} limit. ${allows} ${limit} active ${plural(limit, one, many)}. Archive one or upgrade your plan to add more.`;
}

async function lockAgent(tx: Tx, agentProfileId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM agent_profiles WHERE id = ${agentProfileId}::uuid FOR UPDATE`;
}

async function lockProperty(tx: Tx, propertyId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR UPDATE`;
}

const toMb = (bytes: number) => Math.ceil((bytes / BYTES_PER_MB) * 10) / 10;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
