import { EntitlementKey, type PlanEntitlements } from '@havenhub/shared';

import type { SubscriptionPlanEntitlement } from '../../generated/prisma/client';

/** A plan's limits as a complete map: a missing row means "not included" (0). */
export function entitlementsOf(plan: { entitlements: SubscriptionPlanEntitlement[] }) {
  const limits = Object.fromEntries(
    Object.values(EntitlementKey).map((key) => [key, 0]),
  ) as PlanEntitlements;
  for (const row of plan.entitlements) limits[row.key] = row.limit;
  return limits;
}
