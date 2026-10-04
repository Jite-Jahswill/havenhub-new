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
import { AttachmentsService } from './attachments.service';
import { ChatNotificationsService } from './chat-notifications.service';

export const CHAT_JOBS = {
  digests: 'jobs:chat:email-digests',
  attachments: 'jobs:chat:attachment-cleanup',
} as const;

/** Chat background work, one instance per job at a time (Redis leases). */
@Injectable()
export class ChatMaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ChatMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly notifications: ChatNotificationsService,
    private readonly attachments: AttachmentsService,
    private readonly locks: DistributedLockService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.CHAT_SWEEP_INTERVAL_SECONDS;
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
      await runSweepTick(this.logger, 'chat.sweep', () => this.runOnce());
    } finally {
      this.running = false;
    }
  }

  async runOnce(now = new Date()) {
    const ttl = this.env.SCHEDULED_JOB_LOCK_TTL_SECONDS * 1000;
    const digests = await this.locks.withLock(CHAT_JOBS.digests, ttl, () =>
      this.notifications.sendDue(now.getTime()),
    );
    const cleaned = await this.locks.withLock(CHAT_JOBS.attachments, ttl, () =>
      this.attachments.cleanupUnattached(now),
    );
    return {
      emailed: digests.acquired ? digests.result : null,
      attachmentsRemoved: cleaned.acquired ? cleaned.result : null,
    };
  }
}
