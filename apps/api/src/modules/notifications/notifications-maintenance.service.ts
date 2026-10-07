import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { runSweepTick } from '../../common/logging/request-context';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { PlatformPoliciesService } from '../platform/platform-policies.service';
import { NotificationsService } from './notifications.service';

export const NOTIFICATION_JOBS = { retention: 'jobs:notifications:retention' } as const;

/** Deletes in-app notifications older than the notifications policy's retention. */
@Injectable()
export class NotificationsMaintenanceService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationsMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly policies: PlatformPoliciesService,
    private readonly locks: DistributedLockService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.NOTIFICATION_SWEEP_INTERVAL_SECONDS;
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
      await runSweepTick(this.logger, 'notifications.sweep', () => this.runOnce());
    } finally {
      this.running = false;
    }
  }

  async runOnce(now = new Date()) {
    const ttl = this.env.SCHEDULED_JOB_LOCK_TTL_SECONDS * 1000;
    const days = (await this.policies.get()).notifications.inAppRetentionDays;
    const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
    const run = await this.locks.withLock(NOTIFICATION_JOBS.retention, ttl, () =>
      this.notifications.deleteOlderThan(cutoff),
    );
    return { deleted: run.acquired ? run.result : null };
  }
}
