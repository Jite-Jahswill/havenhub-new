import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PaymentStatus } from '@havenhub/shared';

import { describeError } from '../../common/logging/describe-error';
import { runSweepTick } from '../../common/logging/request-context';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentsService } from './payments.service';

export const PAYMENT_JOBS = { reconcile: 'jobs:payments:reconcile' } as const;

/** Re-checked once old enough that the customer's own return or the webhook should have come. */
export const RECONCILE_MIN_AGE_MS = 15 * 60_000;
/** After this, a payment is no longer re-checked automatically. */
export const RECONCILE_MAX_AGE_MS = 72 * 3600_000;
/** Provider look-ups per payment kind per run (bounds provider traffic). */
export const RECONCILE_BATCH = 25;

type Kind = 'booking' | 'subscription';
export type ReconcileTally = Record<'succeeded' | 'failed' | 'pending' | 'errors', number>;

/**
 * Safety net for payments whose webhook never arrived and whose customer
 * never came back: PENDING booking and subscription payments between 15
 * minutes and 72 hours old are re-verified through the existing `settle`
 * paths — the same provider verification, amount/currency/reference checks,
 * row locks and late-money handling as the webhook. Nothing new about money
 * is decided here, so a webhook racing the sweep settles a payment once.
 *
 * Runs on every instance's timer under one Redis lease. Each run checks at
 * most RECONCILE_BATCH payments of each kind, continuing from a cursor so
 * payments the provider still reports as pending do not starve newer ones.
 */
@Injectable()
export class PaymentReconciliationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly locks: DistributedLockService,
    private readonly payments: PaymentsService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.PAYMENT_RECONCILE_INTERVAL_SECONDS;
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
      await runSweepTick(this.logger, 'payments.reconcile', () => this.runOnce());
    } finally {
      this.running = false;
    }
  }

  /** One run under the lease; `null` when another instance holds it. */
  async runOnce(now = new Date()): Promise<Record<Kind, ReconcileTally> | null> {
    const run = await this.locks.withLock(
      PAYMENT_JOBS.reconcile,
      this.env.SCHEDULED_JOB_LOCK_TTL_SECONDS * 1000,
      async () => ({
        booking: await this.reconcile('booking', now),
        subscription: await this.reconcile('subscription', now),
      }),
    );
    if (!run.acquired) return null;
    const { booking, subscription } = run.result;
    if (booking.succeeded + booking.failed + subscription.succeeded + subscription.failed) {
      this.logger.log('Reconciled pending payments', {
        event: 'payment.reconciled',
        bookings: booking,
        subscriptions: subscription,
      });
    }
    return run.result;
  }

  private async reconcile(kind: Kind, now: Date): Promise<ReconcileTally> {
    const tally: ReconcileTally = { succeeded: 0, failed: 0, pending: 0, errors: 0 };
    const window = {
      gte: new Date(now.getTime() - RECONCILE_MAX_AGE_MS),
      lte: new Date(now.getTime() - RECONCILE_MIN_AGE_MS),
    };
    const cursorKey = `${PAYMENT_JOBS.reconcile}:cursor:${kind}`;
    const cursor = await this.readCursor(cursorKey);
    const where = {
      status: PaymentStatus.PENDING,
      createdAt: window,
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    };
    const query = {
      where,
      orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      take: RECONCILE_BATCH,
      select: { id: true, reference: true, createdAt: true },
    };
    const due =
      kind === 'booking'
        ? await this.prisma.payment.findMany(query)
        : await this.prisma.subscriptionPayment.findMany(query);

    for (const payment of due) {
      try {
        const view =
          kind === 'booking'
            ? await this.payments.settle(payment.reference)
            : await this.subscriptions.settle(payment.reference);
        if (view.paymentStatus === PaymentStatus.PENDING) tally.pending++;
        else if (view.paymentStatus === PaymentStatus.FAILED) tally.failed++;
        else tally.succeeded++;
      } catch (error) {
        // Provider unreachable, unknown reference…: stays PENDING, retried next run.
        tally.errors++;
        this.logger.warn('Payment reconciliation item failed; retried next run', {
          event: 'payment.reconcile_failed',
          kind,
          paymentId: payment.id,
          ...describeError(error),
        });
      }
    }

    // A full batch continues next run after the last one; a short batch wraps around.
    const last = due.at(-1);
    await this.writeCursor(cursorKey, due.length === RECONCILE_BATCH && last ? last : null);
    return tally;
  }

  private async readCursor(key: string): Promise<{ createdAt: Date; id: string } | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      const [at, id] = raw.split('|');
      const createdAt = new Date(at ?? '');
      return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
    } catch {
      return null;
    }
  }

  private async writeCursor(key: string, last: { createdAt: Date; id: string } | null) {
    try {
      if (last) await this.redis.client.set(key, `${last.createdAt.toISOString()}|${last.id}`);
      else await this.redis.client.del(key);
    } catch {
      // Without the cursor the next run simply starts from the oldest payment.
    }
  }
}
