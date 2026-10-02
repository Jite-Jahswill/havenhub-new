import { Injectable } from '@nestjs/common';
import {
  AccountType,
  PERMISSION_KEYS,
  isPermission,
  type Permission,
  type RoleView,
} from '@havenhub/shared';

import { Errors } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';
import { SUPER_ADMIN_ROLE } from './system-roles';

export interface UserAccess {
  roleKeys: string[];
  permissions: Set<Permission>;
}

const NO_ACCESS: UserAccess = { roleKeys: [], permissions: new Set() };

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a user's roles and effective permissions from the database.
   * Only ADMIN accounts can hold permissions: a role accidentally attached to
   * a customer or agent grants nothing.
   */
  async getAccess(userId: string, accountType: AccountType): Promise<UserAccess> {
    if (accountType !== AccountType.ADMIN) return NO_ACCESS;

    const assignments = await this.prisma.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            key: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    const roleKeys = assignments.map((a) => a.role.key);
    if (roleKeys.includes(SUPER_ADMIN_ROLE)) {
      return { roleKeys, permissions: new Set(PERMISSION_KEYS) };
    }

    const permissions = new Set<Permission>();
    for (const { role } of assignments) {
      for (const { permission } of role.permissions) {
        if (isPermission(permission.key)) permissions.add(permission.key);
      }
    }
    return { roleKeys, permissions };
  }

  async listRoles(): Promise<RoleView[]> {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { permissions: { include: { permission: true } } },
    });
    return roles.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions:
        role.key === SUPER_ADMIN_ROLE
          ? [...PERMISSION_KEYS]
          : role.permissions.map((rp) => rp.permission.key).filter(isPermission),
    }));
  }

  /**
   * Replaces an administrator's roles. Escalation rules:
   *  - only ADMIN accounts can hold roles;
   *  - nobody can change their own roles;
   *  - an actor may only grant roles whose permissions they already hold;
   *  - an actor may only modify administrators whose current access is a
   *    subset of their own (a Finance Admin cannot demote a Super Admin).
   */
  async setUserRoles(actor: AuthContext, targetUserId: string, roleKeys: string[]) {
    if (actor.user.id === targetUserId) {
      throw Errors.forbidden('You cannot change your own roles.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, accountType: true },
    });
    if (!target) throw Errors.notFound('User');
    if (target.accountType !== AccountType.ADMIN) {
      throw Errors.badRequest('Roles can only be assigned to administrator accounts.');
    }

    const roles = await this.prisma.role.findMany({ where: { key: { in: roleKeys } } });
    if (roles.length !== roleKeys.length) {
      const found = new Set(roles.map((r) => r.key));
      throw Errors.badRequest(`Unknown role: ${roleKeys.filter((k) => !found.has(k)).join(', ')}`);
    }

    const [granted, targetAccess] = await Promise.all([
      this.permissionsOfRoles(roleKeys),
      this.getAccess(target.id, target.accountType),
    ]);
    const exceeds = (perms: Iterable<Permission>) =>
      [...perms].some((permission) => !actor.permissions.has(permission));
    if (exceeds(granted) || exceeds(targetAccess.permissions)) {
      throw Errors.insufficientPermissions();
    }

    const before = targetAccess.roleKeys;
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: target.id } }),
      this.prisma.userRole.createMany({
        data: roles.map((role) => ({
          userId: target.id,
          roleId: role.id,
          assignedById: actor.user.id,
        })),
      }),
    ]);
    return { before, after: roles.map((r) => r.key) };
  }

  private async permissionsOfRoles(roleKeys: string[]): Promise<Set<Permission>> {
    if (roleKeys.includes(SUPER_ADMIN_ROLE)) return new Set(PERMISSION_KEYS);
    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { key: { in: roleKeys } } },
      select: { permission: { select: { key: true } } },
    });
    return new Set(rows.map((r) => r.permission.key).filter(isPermission));
  }
}
