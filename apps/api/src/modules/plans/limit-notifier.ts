import { Inject, Injectable, Logger } from '@nestjs/common';
import { entitlementDefinition, type EntitlementKey } from '@havenhub/shared';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { MailService } from '../../infrastructure/mail/mail.service';
import { MailTemplates } from '../../infrastructure/mail/mail.templates';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

const ONE_DAY_SECONDS = 24 * 3600;

/**
 * "You reached a plan limit" emails, at most one per agent and allowance a
 * day. Fire-and-forget: it never delays or fails the request that hit the
 * limit (which is rejected regardless).
 */
@Injectable()
export class LimitNotifier {
  private readonly logger = new Logger(LimitNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  limitReached(agentProfileId: string, key: EntitlementKey, planName: string, limit: number) {
    void this.send(agentProfileId, key, planName, limit).catch((error: Error) => {
      this.logger.warn(`Limit notification for ${agentProfileId} skipped: ${error.message}`);
    });
  }

  private async send(agentProfileId: string, key: EntitlementKey, planName: string, limit: number) {
    const first = await this.redis.client.set(
      `notify:limit:${agentProfileId}:${key}`,
      '1',
      'EX',
      ONE_DAY_SECONDS,
      'NX',
    );
    if (first !== 'OK') return;
    const agent = await this.prisma.agentProfile.findUnique({
      where: { id: agentProfileId },
      select: { user: { select: { email: true, fullName: true } } },
    });
    if (!agent) return;
    await this.mail.send(
      MailTemplates.planLimitReached(
        agent.user.email,
        agent.user.fullName.split(' ')[0] ?? agent.user.fullName,
        planName,
        entitlementDefinition(key).label,
        limit,
        `${this.env.WEB_APP_URL}/agent/subscription/plans`,
      ),
    );
  }
}
