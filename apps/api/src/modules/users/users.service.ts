import { Injectable } from '@nestjs/common';
import {
  AccountType,
  UserStatus,
  type adminListUsersQuerySchema,
  type AdminOverview,
  type AdminUpdateUserStatusInput,
  type AdminUserListItem,
  type AgentVerificationStatus,
  type AuthUser,
  type Paginated,
  type UpdateMyProfileInput,
} from '@havenhub/shared';

import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import type { Prisma, User } from '../../generated/prisma/client';
import { ImageProcessor } from '../../infrastructure/media/image-processor.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { SessionService } from '../auth/session.service';
import { RbacService } from '../rbac/rbac.service';
import { SUPER_ADMIN_ROLE } from '../rbac/system-roles';
import { toAuthUser } from './user.mapper';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly images: ImageProcessor,
  ) {}

  async updateMe(userId: string, input: UpdateMyProfileInput): Promise<AuthUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { fullName: input.fullName, phone: input.phone },
    });
    return toAuthUser(user, await this.rbac.getAccess(user.id, user.accountType), (key) =>
      this.storage.url(key),
    );
  }

  async setAvatar(userId: string, file: Buffer): Promise<AuthUser> {
    const rendition = await this.images.avatar(file);
    const key = this.storage.newKey(`avatars/${userId}`, 'avatar');
    await this.storage.put(key, rendition.buffer, 'image/webp');
    const previous = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarKey: true },
    });
    const user = await this.prisma.user.update({ where: { id: userId }, data: { avatarKey: key } });
    if (previous.avatarKey) await this.storage.deleteQuietly(previous.avatarKey);
    return toAuthUser(user, await this.rbac.getAccess(user.id, user.accountType), (k) =>
      this.storage.url(k),
    );
  }

  async removeAvatar(userId: string): Promise<AuthUser> {
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: null },
    });
    if (previous.avatarKey) await this.storage.deleteQuietly(previous.avatarKey);
    return toAuthUser(user, await this.rbac.getAccess(user.id, user.accountType), (k) =>
      this.storage.url(k),
    );
  }

  // ── Administration ───────────────────────────────────────────────────────

  async adminOverview(): Promise<AdminOverview> {
    const [byType, byStatus] = await Promise.all([
      this.prisma.user.groupBy({ by: ['accountType'], _count: { _all: true } }),
      this.prisma.agentProfile.groupBy({ by: ['verificationStatus'], _count: { _all: true } }),
    ]);
    const count = (type: AccountType) =>
      byType.find((r) => r.accountType === type)?._count._all ?? 0;
    const agentsByVerificationStatus = Object.fromEntries(
      (['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'BLOCKED'] as const).map(
        (status) => [
          status,
          byStatus.find((r) => r.verificationStatus === status)?._count._all ?? 0,
        ],
      ),
    ) as Record<AgentVerificationStatus, number>;
    return {
      users: {
        total: byType.reduce((sum, r) => sum + r._count._all, 0),
        customers: count(AccountType.CUSTOMER),
        agents: count(AccountType.AGENT),
        admins: count(AccountType.ADMIN),
      },
      agentsByVerificationStatus,
    };
  }

  async adminList(
    query: z.output<typeof adminListUsersQuerySchema>,
  ): Promise<Paginated<AdminUserListItem>> {
    const where: Prisma.UserWhereInput = {
      ...(query.accountType ? { accountType: query.accountType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { roles: { select: { role: { select: { key: true } } } } },
      }),
    ]);
    return paginate(rows.map(toAdminUserListItem), query.page, query.pageSize, total);
  }

  async adminGet(id: string): Promise<AdminUserListItem> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: { select: { role: { select: { key: true } } } } },
    });
    if (!user) throw Errors.notFound('User');
    return toAdminUserListItem(user);
  }

  /**
   * Suspends, blocks or reactivates an account. Non-active accounts lose all
   * sessions immediately. Only a Super Admin may change another admin's status.
   */
  async adminUpdateStatus(
    actor: AuthContext,
    id: string,
    input: AdminUpdateUserStatusInput,
    meta: RequestMeta,
  ): Promise<AdminUserListItem> {
    if (actor.user.id === id) throw Errors.forbidden('You cannot change your own account status.');
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw Errors.notFound('User');
    if (target.accountType === AccountType.ADMIN && !actor.roleKeys.includes(SUPER_ADMIN_ROLE)) {
      throw Errors.insufficientPermissions();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          status: input.status,
          statusReason: input.status === UserStatus.ACTIVE ? null : (input.reason ?? null),
        },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'user.status.updated',
          resourceType: 'user',
          resourceId: id,
          before: { status: target.status },
          after: { status: input.status, reason: input.reason ?? null },
          meta,
        },
        tx,
      );
    });
    if (input.status !== UserStatus.ACTIVE) {
      await this.sessions.revokeAllForUser(id, 'account_status_changed');
    }
    return this.adminGet(id);
  }
}

function toAdminUserListItem(
  user: User & { roles: { role: { key: string } }[] },
): AdminUserListItem {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    accountType: user.accountType,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    roles: user.roles.map((r) => r.role.key),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
