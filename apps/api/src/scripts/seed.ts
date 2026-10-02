/**
 * Seeds reference data that must exist in every environment (permissions,
 * system roles and the starter amenity catalogue). Idempotent — run after every `prisma migrate deploy`.
 *
 *   pnpm db:seed
 */
import { seedDefaultAmenities } from '../modules/amenities/default-amenities';
import { syncRbac } from '../modules/rbac/rbac-sync';
import { scriptPrisma } from './script-context';

async function main(): Promise<void> {
  const prisma = scriptPrisma();
  try {
    const result = await syncRbac(prisma);
    console.log(`RBAC synced: ${result.permissions} permissions, ${result.roles} system roles.`);
    const amenities = await seedDefaultAmenities(prisma);
    console.log(`Amenities: ${amenities} default(s) added (existing entries untouched).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
