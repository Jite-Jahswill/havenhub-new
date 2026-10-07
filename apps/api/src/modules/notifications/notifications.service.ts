import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type {
  notificationListQuerySchema,
  NotificationPage,
  NotificationType,
  NotificationView,
} from '@havenhub/shared';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { Notification, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

type Db = Pick<PrismaService, 'notification'> | Prisma.TransactionClient;

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Relative path in the web app ("/…"). */
  link?: string | null;
}

/** The realtime event every inbox change sends (a hint; clients re-read). */
export const NOTIFICATIONS_CHANGED = 'notifications.changed';

/** When to check that the writing transaction committed before pushing. */
const PUSH_CHECKS_MS = [100, 400, 1_000, 3_000];

/**
 * In-app notifications.
 *
 * `notify` writes rows inside the caller's transaction, so a notification
 * exists exactly when the change it describes committed. The real-time push
 * waits until the rows are visible (i.e. committed) and is skipped when the
 * transaction rolled back. Delivery is best-effort: the inbox (REST) is the
 * source of truth and the web app re-reads it on load and on reconnect.
 */
@Injectable()
export class NotificationsService implements OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  async notify(db: Db, items: NotificationInput[]): Promise<void> {
    if (items.length === 0) return;
    const rows = await db.notification.createManyAndReturn({
      data: items.map((item) => {
        if (item.link && !item.link.startsWith('/')) {
          throw new Error(`Notification links must be relative paths: ${item.link}`);
        }
        return {
          userId: item.userId,
          type: item.type,
          title: clip(item.title, 160),
          body: clip(item.body, 1000),
          link: item.link ?? null,
        };
      }),
      select: { id: true, userId: true },
    });
    this.pushWhenCommitted(
      rows.map((r) => r.id),
      [...new Set(rows.map((r) => r.userId))],
    );
  }

  /** Tells the users' open tabs to refresh. Call only after the change committed. */
  pushTo(userIds: string[]): void {
    const payload = { eventId: randomUUID() };
    for (const userId of userIds) this.realtime.emitToUser(userId, NOTIFICATIONS_CHANGED, payload);
  }

  // ── Inbox ──

  async list(
    userId: string,
    query: z.output<typeof notificationListQuerySchema>,
  ): Promise<NotificationPage> {
    const { page, pageSize } = query;
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread ? { readAt: null } : {}),
    };
    const [total, rows, unread] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: rows.map(toView),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      unread,
    };
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  /** Marks one of the user's own notifications read (someone else's look like "not found"). */
  async markRead(userId: string, id: string): Promise<NotificationView> {
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw Errors.notFound('Notification');
    if (row.readAt) return toView(row);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    this.pushTo([userId]);
    return toView(updated);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count > 0) this.pushTo([userId]);
    return { updated: count };
  }

  /** Retention: deletes notifications created before `cutoff`, in batches. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (;;) {
      const count = await this.prisma.$executeRaw`
        DELETE FROM notifications WHERE id IN (
          SELECT id FROM notifications WHERE created_at < ${cutoff} LIMIT 5000
        )`;
      deleted += count;
      if (count < 5000) return deleted;
    }
  }

  private pushWhenCommitted(ids: string[], userIds: string[], attempt = 0): void {
    const delay = PUSH_CHECKS_MS[attempt];
    if (delay === undefined) return; // rolled back (or far too slow): nothing to announce
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.prisma.notification
        .count({ where: { id: { in: ids } } })
        .then((visible) => {
          if (visible > 0) this.pushTo(userIds);
          else this.pushWhenCommitted(ids, userIds, attempt + 1);
        })
        .catch((error: Error) =>
          this.logger.warn(`Notification push check failed: ${error.message}`),
        );
    }, delay);
    timer.unref();
    this.timers.add(timer);
  }
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export const toView = (row: Notification): NotificationView => ({
  id: row.id,
  type: row.type as NotificationType,
  title: row.title,
  body: row.body,
  link: row.link,
  read: row.readAt !== null,
  createdAt: row.createdAt.toISOString(),
});
