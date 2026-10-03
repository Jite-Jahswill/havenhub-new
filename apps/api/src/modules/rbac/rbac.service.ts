import { Injectable } from '@nestjs/common';
import {
  AccountType,
  PERMISSION_KEYS,
  isPermission,
  type Permission,
  type RoleView,
} from '@havenhub/shared';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { SUPER_ADMIN_ROLE } from './system-roles';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

export interface UserAccess {
  roleKeys: string[];
  permissions: Set<Permission>;
}

const NO_ACCESS: UserAccess = { roleKeys: [], permissions: new Set() };

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolves a user's roles and effective permissions from the database.
   * Only ADMIN accounts can hold permissions: a role accidentally attached to
   * a customer or agent grants nothing.
   */
  async getAccess(
    userId: string,
    accountType: AccountType,
    db: Db = this.prisma,
  ): Promise<UserAccess> {
    if (accountType !== AccountType.ADMIN) return NO_ACCESS;

    const assignments = await db.userRole.findMany({
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
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
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
      userCount: role._count.users,
      updatedAt: role.updatedAt.toISOString(),
    }));
  }

  /**
   * Replaces an administrator's roles. Escalation rules:
   *  - only ADMIN accounts can hold roles;
   *  - nobody can change their own roles;
   *  - an actor may only grant roles whose permissions they already hold;
   *  - an actor may only modify administrators whose current access is a
   *    subset of their own (a Finance Admin cannot demote a Super Admin);
   *  - the last active Super Admin cannot lose the role.
   * The change and its audit entry commit together; concurrent changes to
   * the same administrator are serialised on their user row.
   */
  async setUserRoles(
    actor: AuthContext,
    targetUserId: string,
    roleKeys: string[],
    meta: RequestMeta,
  ): Promise<{ before: string[]; after: string[] }> {
    if (actor.user.id === targetUserId) {
      throw Errors.forbidden('You cannot change your own roles.');
    }

    return this.prisma.$transaction(async (tx) => {
      // NO KEY UPDATE: serialises changes to this administrator without blocking the
      // foreign-key checks of other transactions (e.g. audit rows naming them as actor).
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${targetUserId}::uuid FOR NO KEY UPDATE`;
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, accountType: true },
      });
      if (!target) throw Errors.notFound('User');
      if (target.accountType !== AccountType.ADMIN) {
        throw Errors.badRequest('Roles can only be assigned to administrator accounts.');
      }

      // FOR SHARE: a role cannot be deleted while it is being assigned.
      const roles = roleKeys.length
        ? await tx.$queryRaw<{ id: string; key: string }[]>`
            SELECT id, key FROM roles WHERE key = ANY(${roleKeys}::text[]) FOR SHARE`
        : [];
      if (roles.length !== roleKeys.length) {
        const found = new Set(roles.map((r) => r.key));
        throw Errors.badRequest(
          `Unknown role: ${roleKeys.filter((k) => !found.has(k)).join(', ')}`,
        );
      }

      // Sequential: one transaction runs one query at a time.
      const granted = await this.permissionsOfRoles(roleKeys, tx);
      const targetAccess = await this.getAccess(target.id, target.accountType, tx);
      const exceeds = (perms: Iterable<Permission>) =>
        [...perms].some((permission) => !actor.permissions.has(permission));
      if (exceeds(granted) || exceeds(targetAccess.permissions)) {
        throw Errors.insufficientPermissions();
      }

      const before = targetAccess.roleKeys;
      if (before.includes(SUPER_ADMIN_ROLE) && !roleKeys.includes(SUPER_ADMIN_ROLE)) {
        await this.assertAnotherSuperAdmin(tx, target.id);
      }

      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.userRole.createMany({
        data: roles.map((role) => ({
          userId: target.id,
          roleId: role.id,
          assignedById: actor.user.id,
        })),
      });
      const after = roles.map((r) => r.key);
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'user.roles.updated',
          resourceType: 'user',
          resourceId: target.id,
          before: { roles: before },
          after: { roles: after },
          meta,
        },
        tx,
      );
      return { before, after };
    });
  }

  /**
   * Refuses unless another active administrator keeps the Super Admin role.
   * Serialised on one advisory lock, so two Super Admins demoting each other
   * at the same moment cannot both succeed.
   */
  async assertAnotherSuperAdmin(tx: Tx, leavingUserId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rbac:super_admins'))`;
    const others = await tx.userRole.count({
      where: {
        role: { key: SUPER_ADMIN_ROLE },
        userId: { not: leavingUserId },
        user: { status: 'ACTIVE', accountType: AccountType.ADMIN },
      },
    });
    if (!others) {
      throw Errors.conflict('At least one active Super Admin must remain.');
    }
  }

  private async permissionsOfRoles(
    roleKeys: string[],
    db: Db = this.prisma,
  ): Promise<Set<Permission>> {
    if (roleKeys.includes(SUPER_ADMIN_ROLE)) return new Set(PERMISSION_KEYS);
    const rows = await db.rolePermission.findMany({
      where: { role: { key: { in: roleKeys } } },
      select: { permission: { select: { key: true } } },
    });
    return new Set(rows.map((r) => r.permission.key).filter(isPermission));
  }
}
