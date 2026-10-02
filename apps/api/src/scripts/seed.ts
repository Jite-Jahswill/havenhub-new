/**
 * Seeds reference data that must exist in every environment (permissions,
 * system roles, the starter amenity catalogue and the free default plan). Idempotent — run after every `prisma migrate deploy`.
 *
 *   pnpm db:seed
 */
import { seedDefaultAmenities } from '../modules/amenities/default-amenities';
import { syncRbac } from '../modules/rbac/rbac-sync';
import { seedDefaultPlan } from '../modules/subscriptions/default-plan';
import { scriptPrisma } from './script-context';

async function main(): Promise<void> {
  const prisma = scriptPrisma();
  try {
    const result = await syncRbac(prisma);
    console.log(`RBAC synced: ${result.permissions} permissions, ${result.roles} system roles.`);
    const amenities = await seedDefaultAmenities(prisma);
    console.log(`Amenities: ${amenities} default(s) added (existing entries untouched).`);
    const plan = await seedDefaultPlan(prisma);
    console.log(
      plan
        ? 'Subscription plans: default free plan created.'
        : 'Subscription plans: default plan already exists (untouched).',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
