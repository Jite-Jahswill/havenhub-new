import type { PlanEntitlements } from '@havenhub/shared';

import type { PrismaClient } from '../../generated/prisma/client';

/**
 * The free tier every agent is on without a paid term. Spec §10 fixes it at
 * exactly one property; image/video allowances keep the values agents have
 * had since Phase 2. Storage is bounded by those counts, so it is not capped
 * separately. Features HavenHub does not offer yet are not included (0).
 *
 * This is only the *initial* row: administrators edit the plan afterwards,
 * and the seed never overwrites it.
 */
export const DEFAULT_FREE_PLAN = {
  slug: 'free',
  name: 'Free',
  description: 'Every agent starts here. List one property at no cost.',
  rank: 0,
  features: ['1 property', 'Up to 10 photos and 1 video per property'],
  entitlements: {
    PROPERTY_COUNT: 1,
    IMAGES_PER_PROPERTY: 10,
    VIDEOS_PER_PROPERTY: 1,
    FEATURED_PROPERTY_COUNT: 0,
    STORAGE_MB: null,
    EVENT_COUNT: 0,
    TOUR_COUNT: 0,
    CLEANING_SERVICE_COUNT: 0,
    HOTEL_COUNT: 0,
  } satisfies PlanEntitlements,
};

/** Creates the default plan if none exists. Idempotent; never edits an existing plan. */
export async function seedDefaultPlan(prisma: PrismaClient): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('subscription_plans:default'))`;
    if (await tx.subscriptionPlan.findFirst({ where: { isDefault: true } })) return false;
    const { entitlements, ...plan } = DEFAULT_FREE_PLAN;
    await tx.subscriptionPlan.create({
      data: {
        ...plan,
        isDefault: true,
        priceKobo: 0n,
        billingInterval: null,
        entitlements: {
          create: Object.entries(entitlements).map(([key, limit]) => ({
            key: key as keyof PlanEntitlements,
            limit,
          })),
        },
      },
    });
    return true;
  });
}
