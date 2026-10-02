import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, PropertyStatus, type PlanLimitsView } from '@havenhub/shared';

import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';

/**
 * TEMPORARY plan definition until admin-managed subscription plans arrive
 * (Phase 4). The spec fixes the free tier at exactly one property; the media
 * allowances are interim values. Phase 4 replaces `limitsFor()` with a lookup
 * of the agent's active SubscriptionPlan — callers do not change.
 */
const FREE_PLAN: PlanLimitsView = {
  planName: 'Free',
  isDefaultPlan: true,
  maxProperties: 1,
  maxImagesPerProperty: 10,
  maxVideosPerProperty: 1,
};

/** Archived properties do not count towards the property allowance. */
export const COUNTED_STATUSES = [
  PropertyStatus.DRAFT,
  PropertyStatus.PENDING_REVIEW,
  PropertyStatus.PUBLISHED,
  PropertyStatus.REJECTED,
  PropertyStatus.SUSPENDED,
];

type Tx = Prisma.TransactionClient;

/**
 * Single place where plan allowances are enforced. Every check runs inside
 * the caller's transaction after locking the owning row, so concurrent
 * requests cannot both slip under a limit.
 */
@Injectable()
export class PlanLimitsService {
  limitsFor(_agentProfileId: string): Promise<PlanLimitsView> {
    return Promise.resolve(FREE_PLAN);
  }

  async assertCanAddProperty(tx: Tx, agentProfileId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM agent_profiles WHERE id = ${agentProfileId}::uuid FOR UPDATE`;
    const [limits, used] = await Promise.all([
      this.limitsFor(agentProfileId),
      tx.property.count({ where: { agentProfileId, status: { in: COUNTED_STATUSES } } }),
    ]);
    if (used >= limits.maxProperties) {
      throw limitReached(
        `Your ${limits.planName} plan allows ${limits.maxProperties} active ${plural(limits.maxProperties, 'property', 'properties')}. Archive one or upgrade when paid plans launch.`,
      );
    }
  }

  async assertCanAddImage(tx: Tx, agentProfileId: string, propertyId: string): Promise<void> {
    await lockProperty(tx, propertyId);
    const [limits, used] = await Promise.all([
      this.limitsFor(agentProfileId),
      tx.propertyImage.count({ where: { propertyId } }),
    ]);
    if (used >= limits.maxImagesPerProperty) {
      throw limitReached(`Your plan allows ${limits.maxImagesPerProperty} images per property.`);
    }
  }

  async assertCanAddVideo(tx: Tx, agentProfileId: string, propertyId: string): Promise<void> {
    await lockProperty(tx, propertyId);
    const [limits, used] = await Promise.all([
      this.limitsFor(agentProfileId),
      tx.propertyVideo.count({ where: { propertyId } }),
    ]);
    if (used >= limits.maxVideosPerProperty) {
      throw limitReached(
        `Your plan allows ${limits.maxVideosPerProperty} ${plural(limits.maxVideosPerProperty, 'video', 'videos')} per property.`,
      );
    }
  }
}

async function lockProperty(tx: Tx, propertyId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR UPDATE`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const limitReached = (message: string) =>
  new AppException(HttpStatus.FORBIDDEN, ErrorCode.PLAN_LIMIT_REACHED, message);
