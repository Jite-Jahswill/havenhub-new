import { Injectable } from '@nestjs/common';
import {
  AccountType,
  NotificationType,
  UserStatus,
  type NotificationAudience,
  type NotificationBroadcastView,
  type Paginated,
  type sendBroadcastSchema,
} from '@havenhub/shared';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NOTIFICATIONS_CHANGED } from './notifications.service';

const AUDIENCE_TYPES: Record<Exclude<NotificationAudience, 'USER'>, AccountType[]> = {
  ALL: [AccountType.CUSTOMER, AccountType.AGENT],
  CUSTOMERS: [AccountType.CUSTOMER],
  AGENTS: [AccountType.AGENT],
};

/**
 * Administrator announcements to an audience of active customers and/or
 * agents, or to one person. Every recipient's inbox row is written in one
 * INSERT … SELECT together with the broadcast record and its audit entry.
 */
@Injectable()
export class NotificationBroadcastsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async send(
    actor: AuthContext,
    input: z.output<typeof sendBroadcastSchema>,
    meta: RequestMeta,
  ): Promise<NotificationBroadcastView> {
    let recipient: { id: string; email: string } | null = null;
    if (input.audience === 'USER') {
      recipient = await this.prisma.user.findFirst({
        where: {
          email: { equals: input.email!, mode: 'insensitive' },
          status: UserStatus.ACTIVE,
        },
        select: { id: true, email: true },
      });
      if (!recipient) throw Errors.notFound('An active account with that email');
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const broadcast = await tx.notificationBroadcast.create({
        data: {
          audience: input.audience,
          recipientEmail: recipient?.email ?? null,
          title: input.title,
          body: input.body,
          link: input.link,
          recipientCount: 0,
          sentById: actor.user.id,
        },
      });
      const recipients = recipient
        ? Prisma.sql`SELECT ${recipient.id}::uuid AS id`
        : Prisma.sql`SELECT id FROM users WHERE status = ${UserStatus.ACTIVE}::"UserStatus"
            AND account_type::text IN (${Prisma.join(
              AUDIENCE_TYPES[input.audience as Exclude<NotificationAudience, 'USER'>],
            )})`;
      const count = await tx.$executeRaw`
        INSERT INTO notifications (id, user_id, type, title, body, link, broadcast_id, created_at)
        SELECT gen_random_uuid(), r.id, ${NotificationType.ANNOUNCEMENT}, ${input.title},
               ${input.body}, ${input.link}, ${broadcast.id}::uuid, now()
        FROM (${recipients}) r`;
      await tx.notificationBroadcast.update({
        where: { id: broadcast.id },
        data: { recipientCount: count },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'notification.broadcast.sent',
          resourceType: 'notification_broadcast',
          resourceId: broadcast.id,
          after: {
            audience: input.audience,
            recipientEmail: recipient?.email ?? null,
            title: input.title,
            recipientCount: count,
          },
          meta,
        },
        tx,
      );
      return broadcast.id;
    });

    // After commit. A content-free hint; each client re-reads its own inbox.
    const payload = { eventId: randomUUID() };
    if (recipient) this.realtime.emitToUser(recipient.id, NOTIFICATIONS_CHANGED, payload);
    else this.realtime.emitToAll(NOTIFICATIONS_CHANGED, payload);
    return this.get(id);
  }

  async list(page: number, pageSize: number): Promise<Paginated<NotificationBroadcastView>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.notificationBroadcast.count(),
      this.prisma.notificationBroadcast.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { sentBy: { select: { id: true, fullName: true } } },
      }),
    ]);
    return {
      items: rows.map(toView),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private async get(id: string): Promise<NotificationBroadcastView> {
    return toView(
      await this.prisma.notificationBroadcast.findUniqueOrThrow({
        where: { id },
        include: { sentBy: { select: { id: true, fullName: true } } },
      }),
    );
  }
}

type Row = Prisma.NotificationBroadcastGetPayload<{
  include: { sentBy: { select: { id: true; fullName: true } } };
}>;

const toView = (r: Row): NotificationBroadcastView => ({
  id: r.id,
  audience: r.audience as NotificationAudience,
  recipientEmail: r.recipientEmail,
  title: r.title,
  body: r.body,
  link: r.link,
  recipientCount: r.recipientCount,
  sentBy: r.sentBy,
  createdAt: r.createdAt.toISOString(),
});
