import type { PrismaClient } from '../../generated/prisma/client';

/**
 * Ensures the platform settings row exists (maintenance off, review required
 * for every listing type). Never changes an existing row.
 */
export async function seedPlatformDefaults(prisma: PrismaClient): Promise<{ created: number }> {
  const { count } = await prisma.platformSettings.createMany({
    data: [{ id: 1 }],
    skipDuplicates: true,
  });
  return { created: count };
}
