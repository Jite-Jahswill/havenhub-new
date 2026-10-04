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
import { CampaignsService } from './campaigns.service';
import { CareersService } from './careers.service';
import { NewsletterService } from './newsletter.service';

export const CMS_JOBS = {
  campaigns: 'jobs:cms:campaigns',
  cvRetention: 'jobs:cms:cv-retention',
  newsletterRetention: 'jobs:cms:newsletter-retention',
} as const;

/** CMS background work, one instance per job at a time (Redis leases). */
@Injectable()
export class CmsMaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CmsMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly campaigns: CampaignsService,
    private readonly careers: CareersService,
    private readonly newsletter: NewsletterService,
    private readonly locks: DistributedLockService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.CMS_SWEEP_INTERVAL_SECONDS;
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
      await runSweepTick(this.logger, 'cms.sweep', () => this.runOnce());
    } finally {
      this.running = false;
    }
  }

  async runOnce(now = new Date()) {
    const ttl = this.env.SCHEDULED_JOB_LOCK_TTL_SECONDS * 1000;
    const campaigns = await this.locks.withLock(CMS_JOBS.campaigns, ttl, () =>
      this.campaigns.runDue(now),
    );
    const retention = await this.locks.withLock(CMS_JOBS.cvRetention, ttl, () =>
      this.careers.purgeExpiredCvs(now),
    );
    const subscribers = await this.locks.withLock(CMS_JOBS.newsletterRetention, ttl, () =>
      this.newsletter.eraseExpired(now),
    );
    return {
      campaigns: campaigns.acquired ? campaigns.result : null,
      cvsRemoved: retention.acquired ? retention.result : null,
      subscribersErased: subscribers.acquired ? subscribers.result : null,
    };
  }
}
