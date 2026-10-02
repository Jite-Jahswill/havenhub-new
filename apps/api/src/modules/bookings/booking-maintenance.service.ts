import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AgentEarningStatus, BookingStatus, todayInNigeria } from '@havenhub/shared';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { AuditService } from '../audit/audit.service';
import { BookingStateService } from './booking-state.service';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Distributed-lock names; each job is locked on its own. */
export const BOOKING_JOBS = {
  expireHolds: 'jobs:bookings:expire-holds',
  releaseEarnings: 'jobs:bookings:release-earnings',
  completeStays: 'jobs:bookings:complete-stays',
} as const;

/**
 * Time-driven transitions. Correctness never depends on this running: stale
 * holds are also released inside booking creation, and the availability
 * check ignores lapsed holds. The sweep keeps statuses and earnings current.
 *
 * Every API instance runs the timer, so each job runs under a Redis lease
 * (`DistributedLockService`): one instance at a time, and a crashed holder's
 * lease lapses after SCHEDULED_JOB_LOCK_TTL_SECONDS. Each item is still
 * re-checked under a row lock, so a job that does run twice changes nothing
 * the second time.
 */
@Injectable()
export class BookingMaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BookingMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: BookingStateService,
    private readonly audit: AuditService,
    private readonly locks: DistributedLockService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.BOOKING_SWEEP_INTERVAL_SECONDS;
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
      await this.runOnce();
    } catch (error) {
      this.logger.error(`Booking sweep failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Runs every job once, each under its distributed lock. A job another
   * instance is running reports `null`; otherwise the number of records it
   * actually changed. A job that throws releases its lock and is retried on
   * the next tick.
   */
  async runOnce(today = todayInNigeria()) {
    const expired = await this.runJob(BOOKING_JOBS.expireHolds, () =>
      this.prisma.$transaction((tx) => this.state.expireStaleHolds(tx)),
    );
    const released = await this.runJob(BOOKING_JOBS.releaseEarnings, () =>
      this.releaseEarnings(today),
    );
    const completed = await this.runJob(BOOKING_JOBS.completeStays, () =>
      this.completeStays(today),
    );
    return { expired, released, completed };
  }

  private async runJob(name: string, job: () => Promise<number>): Promise<number | null> {
    const run = await this.locks.withLock(
      name,
      this.env.SCHEDULED_JOB_LOCK_TTL_SECONDS * 1000,
      job,
    );
    return run.acquired ? run.result : null;
  }

  /** A stay's earning becomes payable once the stay has started. */
  async releaseEarnings(today: string): Promise<number> {
    const due = await this.prisma.agentEarning.findMany({
      where: {
        status: AgentEarningStatus.PENDING,
        booking: {
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
          startDate: { lte: day(today) },
        },
      },
      select: { id: true },
      take: 500,
    });
    let released = 0;
    for (const { id } of due) {
      const changed = await this.prisma.$transaction(async (tx) => {
        // Lock order booking → earning, as everywhere else. The booking may
        // have been cancelled since the query above: re-check it under lock.
        const { bookingId } = await tx.agentEarning.findUniqueOrThrow({
          where: { id },
          select: { bookingId: true },
        });
        const booking = await this.state.lock(tx, bookingId);
        const stayStarted =
          (booking.status === BookingStatus.CONFIRMED ||
            booking.status === BookingStatus.COMPLETED) &&
          booking.startDate <= day(today);
        if (!stayStarted) return false;
        await tx.$queryRaw`SELECT id FROM agent_earnings WHERE id = ${id}::uuid FOR UPDATE`;
        const earning = await tx.agentEarning.findUniqueOrThrow({ where: { id } });
        if (earning.status !== AgentEarningStatus.PENDING) return false;
        await tx.agentEarning.update({
          where: { id },
          data: { status: AgentEarningStatus.AVAILABLE, availableAt: new Date() },
        });
        await this.audit.record(
          {
            actorId: null,
            action: 'agent_earning.available',
            resourceType: 'agent_earning',
            resourceId: id,
            before: { status: earning.status },
            after: {
              status: AgentEarningStatus.AVAILABLE,
              amountKobo: earning.amountKobo.toString(),
            },
          },
          tx,
        );
        return true;
      });
      if (changed) released++;
    }
    return released;
  }

  /** Confirmed stays whose check-out day has arrived are completed. */
  async completeStays(today: string): Promise<number> {
    const due = await this.prisma.booking.findMany({
      where: { status: BookingStatus.CONFIRMED, endDate: { lte: day(today) } },
      select: { id: true },
      take: 500,
    });
    let completed = 0;
    for (const { id } of due) {
      const changed = await this.prisma.$transaction(async (tx) => {
        const booking = await this.state.lock(tx, id);
        if (booking.status !== BookingStatus.CONFIRMED) return false;
        await this.state.transition(tx, booking, BookingStatus.COMPLETED, {
          actorId: null,
          data: { completedAt: new Date() },
        });
        return true;
      });
      if (changed) completed++;
    }
    return completed;
  }
}
