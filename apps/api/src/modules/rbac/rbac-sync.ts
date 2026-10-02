import { PERMISSIONS, PERMISSION_KEYS } from '@havenhub/shared';

import type { PrismaClient } from '../../generated/prisma/client';
import { SYSTEM_ROLES, resolveRolePermissions } from './system-roles';

/**
 * Idempotently syncs the permission catalogue and system roles into the
 * database. Safe to run on every deploy. Custom roles are left untouched.
 */
export async function syncRbac(
  prisma: PrismaClient,
): Promise<{ permissions: number; roles: number }> {
  await prisma.$transaction(async (tx) => {
    for (const key of PERMISSION_KEYS) {
      await tx.permission.upsert({
        where: { key },
        create: { key, description: PERMISSIONS[key] },
        update: { description: PERMISSIONS[key] },
      });
    }

    const permissionIds = new Map(
      (await tx.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
    );

    for (const definition of SYSTEM_ROLES) {
      const role = await tx.role.upsert({
        where: { key: definition.key },
        create: {
          key: definition.key,
          name: definition.name,
          description: definition.description,
          isSystem: true,
        },
        update: { name: definition.name, description: definition.description, isSystem: true },
      });

      const wanted = resolveRolePermissions(definition).map((key) => permissionIds.get(key)!);
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wanted } },
      });
      await tx.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  });

  return { permissions: PERMISSION_KEYS.length, roles: SYSTEM_ROLES.length };
}
