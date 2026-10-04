import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AgentSubscriptionStatus as S } from '@havenhub/shared';

import { runSweepTick } from '../../common/logging/request-context';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionNotifier } from './subscription-notifier';
import { SubscriptionsService } from './subscriptions.service';

export const SUBSCRIPTION_JOBS = {
  reconcile: 'jobs:subscriptions:reconcile',
  remind: 'jobs:subscriptions:remind',
} as const;

/** Reminder lead time before a term ends (plans do not renew automatically). */
export const EXPIRY_REMINDER_DAYS = 3;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Time-driven subscription work, run on every API instance but under the
 * same Redis leases as the booking sweep (one instance per job at a time).
 * Entitlements never depend on this running: the plan in force is computed
 * from term dates on every request. The sweep keeps statuses, featured
 * slots and emails current.
 */
@Injectable()
export class SubscriptionMaintenanceService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SubscriptionMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly subscriptions: SubscriptionsService,
    private readonly notifier: SubscriptionNotifier,
    private readonly locks: DistributedLockService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.SUBSCRIPTION_SWEEP_INTERVAL_SECONDS;
    if (seconds <= 0) return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await runSweepTick(this.logger, 'subscriptions.sweep', () => this.runOnce());
    } finally {
      this.running = false;
    }
  }

  /** Each job under its own lock; `null` = another instance is running it. */
  async runOnce(now = new Date()) {
    const ttl = this.env.SCHEDULED_JOB_LOCK_TTL_SECONDS * 1000;
    const reconciled = await this.locks.withLock(SUBSCRIPTION_JOBS.reconcile, ttl, () =>
      this.reconcileDue(now),
    );
    const reminded = await this.locks.withLock(SUBSCRIPTION_JOBS.remind, ttl, () =>
      this.sendReminders(now),
    );
    return {
      reconciled: reconciled.acquired ? reconciled.result : null,
      reminded: reminded.acquired ? reminded.result : null,
    };
  }

  /** Ends finished terms and starts scheduled ones. Returns how many agents changed. */
  async reconcileDue(now = new Date()): Promise<number> {
    const due = await this.prisma.agentSubscription.findMany({
      where: {
        OR: [
          { status: { in: [S.ACTIVE, S.SUSPENDED] }, currentPeriodEnd: { lte: now } },
          { status: S.PENDING, currentPeriodStart: { lte: now } },
        ],
      },
      distinct: ['agentProfileId'],
      select: { agentProfileId: true },
      take: 500,
    });
    let changed = 0;
    for (const { agentProfileId } of due) {
      const events = await this.prisma.$transaction((tx) =>
        this.lifecycle.reconcile(tx, agentProfileId, now),
      );
      if (events.length > 0) changed++;
      await this.subscriptions.notify(events, agentProfileId);
    }
    return changed;
  }

  /**
   * One reminder per term, a few days before it ends — unless a paid
   * follow-on term is already queued. The claim (`expiryReminderAt`) is a
   * conditional update, so concurrent runs never send twice.
   */
  async sendReminders(now = new Date()): Promise<number> {
    const horizon = new Date(now.getTime() + EXPIRY_REMINDER_DAYS * DAY_MS);
    const ending = await this.prisma.agentSubscription.findMany({
      where: {
        status: S.ACTIVE,
        expiryReminderAt: null,
        currentPeriodEnd: { gt: now, lte: horizon },
      },
      select: { id: true, agentProfileId: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
      take: 500,
    });
    let sent = 0;
    for (const term of ending) {
      const claimed = await this.prisma.agentSubscription.updateMany({
        where: { id: term.id, expiryReminderAt: null },
        data: { expiryReminderAt: now },
      });
      if (claimed.count === 0) continue;
      const followOn = await this.prisma.agentSubscription.count({
        where: {
          agentProfileId: term.agentProfileId,
          status: S.PENDING,
          currentPeriodStart: { gte: term.currentPeriodEnd },
        },
      });
      if (followOn > 0 || term.cancelAtPeriodEnd) continue;
      await this.notifier.expiring(term.id);
      sent++;
    }
    return sent;
  }
}
