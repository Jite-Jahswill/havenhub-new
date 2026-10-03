import { Injectable } from '@nestjs/common';
import {
  addDays,
  type AuditLogDetail,
  type AuditLogView,
  type Paginated,
  type auditLogQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';

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

  /** Newest first, filtered by actor, action, resource and Nigerian calendar dates. */
  async list(query: z.output<typeof auditLogQuerySchema>): Promise<Paginated<AuditLogView>> {
    const where = auditWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
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
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(id: string): Promise<AuditLogDetail> {
    const row = await this.prisma.auditLog.findUnique({
      where: { id },
      include: { actor: { select: { id: true, fullName: true, email: true } } },
    });
    if (!row) throw Errors.notFound('Audit entry');
    return {
      id: row.id,
      actor: row.actor,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      before: row.before,
      after: row.after,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Start of a calendar day in Nigeria (WAT, UTC+1). */
export const watDayStart = (isoDate: string) => new Date(`${isoDate}T00:00:00+01:00`);

function auditWhere(query: z.output<typeof auditLogQuerySchema>): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (query.actor) {
    where.actorId = UUID.test(query.actor) ? query.actor : undefined;
    if (!UUID.test(query.actor)) {
      where.actor = {
        OR: [
          { email: { contains: query.actor, mode: 'insensitive' } },
          { fullName: { contains: query.actor, mode: 'insensitive' } },
        ],
      };
    }
  }
  if (query.action) {
    where.action = query.action.endsWith('.')
      ? { startsWith: query.action }
      : { equals: query.action };
  }
  if (query.resourceType) where.resourceType = query.resourceType;
  if (query.resourceId) where.resourceId = query.resourceId;
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: watDayStart(query.from) } : {}),
      ...(query.to ? { lt: watDayStart(addDays(query.to, 1)) } : {}),
    };
  }
  return where;
}
