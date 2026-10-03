import { Injectable } from '@nestjs/common';
import {
  AccountType,
  PERMISSION_KEYS,
  isPermission,
  type Permission,
  type RoleDetail,
  type createRoleSchema,
  type updateRoleSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { SUPER_ADMIN_ROLE } from './system-roles';

type Tx = Prisma.TransactionClient;

/** Custom role keys are generated, prefixed so they never collide with system roles. */
const CUSTOM_PREFIX = 'custom_';

/**
 * Custom roles. System roles are read-only here (they are defined in code
 * and re-synced on every deploy). Rules enforced on every change:
 *  - the actor may only include permissions they hold themselves;
 *  - the actor may only change or delete a role whose permissions they hold;
 *  - nobody edits a role they hold (that would change their own access);
 *  - a role still held by anyone cannot be deleted (no silent un-assigning);
 *  - each change locks the role row and is audited in the same transaction.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(key: string): Promise<RoleDetail> {
    const role = await this.prisma.role.findUnique({
      where: { key },
      include: {
        permissions: { include: { permission: true } },
        users: {
          where: { user: { accountType: AccountType.ADMIN } },
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, fullName: true, email: true } } },
        },
        _count: { select: { users: true } },
      },
    });
    if (!role) throw Errors.notFound('Role');
    return {
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions:
        role.key === SUPER_ADMIN_ROLE
          ? [...PERMISSION_KEYS]
          : role.permissions.map((rp) => rp.permission.key).filter(isPermission),
      userCount: role._count.users,
      users: role.users.map((u) => u.user),
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  async create(
    actor: AuthContext,
    input: z.output<typeof createRoleSchema>,
    meta: RequestMeta,
  ): Promise<RoleDetail> {
    const permissions = input.permissions as Permission[];
    assertHolds(actor, permissions);
    const key = await this.prisma.$transaction(async (tx) => {
      // Serialise key generation so two roles with the same name get distinct keys.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rbac:role-keys'))`;
      const roleKey = await uniqueKey(tx, input.name);
      const role = await tx.role.create({
        data: {
          key: roleKey,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          permissions: { create: await permissionLinks(tx, permissions) },
        },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'rbac.role.created',
          resourceType: 'role',
          resourceId: role.key,
          after: { name: role.name, description: role.description, permissions },
          meta,
        },
        tx,
      );
      return role.key;
    });
    return this.get(key);
  }

  async update(
    actor: AuthContext,
    key: string,
    input: z.output<typeof updateRoleSchema>,
    meta: RequestMeta,
  ): Promise<RoleDetail> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedCustom(tx, key, actor);
      const held = await tx.userRole.count({
        where: { roleId: current.id, userId: actor.user.id },
      });
      if (held) throw Errors.forbidden('You cannot change a role you hold.');

      const nextPermissions =
        (input.permissions as Permission[] | undefined) ?? current.permissions;
      assertHolds(actor, nextPermissions);

      if (input.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: current.id } });
        await tx.rolePermission.createMany({
          data: (await permissionLinks(tx, nextPermissions)).map((link) => ({
            roleId: current.id,
            permissionId: link.permissionId,
          })),
        });
      }
      const updated = await tx.role.update({
        where: { id: current.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          // Bump updatedAt even when only permissions changed.
          updatedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'rbac.role.updated',
          resourceType: 'role',
          resourceId: key,
          before: {
            name: current.name,
            description: current.description,
            permissions: current.permissions,
          },
          after: {
            name: updated.name,
            description: updated.description,
            permissions: nextPermissions,
          },
          meta,
        },
        tx,
      );
    });
    return this.get(key);
  }

  async remove(actor: AuthContext, key: string, meta: RequestMeta): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedCustom(tx, key, actor);
      const holders = await tx.userRole.count({ where: { roleId: current.id } });
      if (holders) {
        throw Errors.conflict(
          `This role is still assigned to ${holders} administrator${holders === 1 ? '' : 's'}. Remove it from them first.`,
        );
      }
      await tx.role.delete({ where: { id: current.id } });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'rbac.role.deleted',
          resourceType: 'role',
          resourceId: key,
          before: {
            name: current.name,
            description: current.description,
            permissions: current.permissions,
          },
          meta,
        },
        tx,
      );
    });
    return { deleted: true };
  }

  /** Locks a custom role the actor is allowed to manage. */
  private async lockedCustom(tx: Tx, key: string, actor: AuthContext) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM roles WHERE key = ${key} FOR UPDATE`;
    if (!locked) throw Errors.notFound('Role');
    const role = await tx.role.findUniqueOrThrow({
      where: { id: locked.id },
      include: { permissions: { include: { permission: true } } },
    });
    if (role.isSystem) {
      throw Errors.forbidden('Built-in roles cannot be changed or deleted.');
    }
    const permissions = role.permissions.map((rp) => rp.permission.key).filter(isPermission);
    assertHolds(actor, permissions);
    return { ...role, permissions };
  }
}

function assertHolds(actor: AuthContext, permissions: Iterable<Permission>): void {
  for (const permission of permissions) {
    if (!actor.permissions.has(permission)) throw Errors.insufficientPermissions();
  }
}

async function permissionLinks(tx: Tx, keys: Permission[]) {
  const rows = await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
  if (rows.length !== keys.length) {
    // The catalogue is synced on deploy; a missing row means the seed has not run.
    throw Errors.badRequest('Some permissions are not available yet. Please try again later.');
  }
  return rows.map((row) => ({ permissionId: row.id }));
}

async function uniqueKey(tx: Tx, name: string): Promise<string> {
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'role';
  const base = `${CUSTOM_PREFIX}${slug}`;
  for (let n = 1; n < 100; n++) {
    const key = n === 1 ? base : `${base}_${n}`;
    if (!(await tx.role.findUnique({ where: { key }, select: { id: true } }))) return key;
  }
  throw Errors.conflict('Too many roles with this name. Choose another name.');
}
