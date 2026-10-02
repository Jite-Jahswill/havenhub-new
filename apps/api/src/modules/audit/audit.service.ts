import { Injectable } from '@nestjs/common';
import type { AuditLogView, Paginated } from '@havenhub/shared';

import type { RequestMeta } from '../../common/http/request-meta';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  meta?: RequestMeta;
}

type Db = Pick<PrismaService, 'auditLog'> | Prisma.TransactionClient;

/**
 * Append-only audit trail. Callers pass already-redacted snapshots — never
 * secrets, NINs or account numbers. Pass a transaction client to make the
 * log entry atomic with the change it describes.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        before: entry.before,
        after: entry.after,
        ipAddress: entry.meta?.ipAddress ?? null,
        userAgent: entry.meta?.userAgent ?? null,
      },
    });
  }

  async list(page: number, pageSize: number): Promise<Paginated<AuditLogView>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, fullName: true, email: true } } },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        actor: row.actor,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
