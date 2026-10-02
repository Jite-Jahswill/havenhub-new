import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { MailService } from '../../infrastructure/mail/mail.service';
import { MailTemplates } from '../../infrastructure/mail/mail.templates';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { formatDay } from './subscription.mapper';

/**
 * Subscription emails (email is HavenHub's notification channel until the
 * in-app centre arrives). Called after the change has committed; a delivery
 * problem is logged and never undoes or fails the change itself.
 */
@Injectable()
export class SubscriptionNotifier {
  private readonly logger = new Logger(SubscriptionNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get subscriptionUrl() {
    return `${this.env.WEB_APP_URL}/agent/subscription`;
  }

  private get plansUrl() {
    return `${this.env.WEB_APP_URL}/agent/subscription/plans`;
  }

  async started(subscriptionId: string): Promise<void> {
    await this.withTerm(subscriptionId, (to, name, term) =>
      term.status === 'ACTIVE'
        ? MailTemplates.subscriptionStarted(
            to,
            name,
            term.plan.name,
            formatDay(term.currentPeriodEnd),
            this.subscriptionUrl,
            term.changeType === 'UPGRADE',
          )
        : MailTemplates.subscriptionScheduled(
            to,
            name,
            term.plan.name,
            formatDay(term.currentPeriodStart),
            this.subscriptionUrl,
          ),
    );
  }

  async expiring(subscriptionId: string): Promise<void> {
    await this.withTerm(subscriptionId, (to, name, term) =>
      MailTemplates.subscriptionExpiring(
        to,
        name,
        term.plan.name,
        formatDay(term.currentPeriodEnd),
        this.plansUrl,
      ),
    );
  }

  async ended(subscriptionId: string, reason: string, fallbackPlan: string): Promise<void> {
    await this.withTerm(subscriptionId, (to, name, term) =>
      MailTemplates.subscriptionEnded(
        to,
        name,
        term.plan.name,
        reason,
        fallbackPlan,
        this.plansUrl,
      ),
    );
  }

  async paymentFailed(agentProfileId: string, planName: string): Promise<void> {
    try {
      const agent = await this.prisma.agentProfile.findUnique({
        where: { id: agentProfileId },
        select: { user: { select: { email: true, fullName: true } } },
      });
      if (!agent) return;
      await this.mail.send(
        MailTemplates.subscriptionPaymentFailed(
          agent.user.email,
          firstName(agent.user.fullName),
          planName,
          this.plansUrl,
        ),
      );
    } catch (error) {
      this.logger.warn(`Payment-failed notification skipped: ${(error as Error).message}`);
    }
  }

  private async withTerm(
    subscriptionId: string,
    build: (
      to: string,
      name: string,
      term: NonNullable<Awaited<ReturnType<SubscriptionNotifier['loadTerm']>>>,
    ) => Parameters<MailService['send']>[0],
  ): Promise<void> {
    try {
      const term = await this.loadTerm(subscriptionId);
      if (!term) return;
      const user = term.agentProfile.user;
      await this.mail.send(build(user.email, firstName(user.fullName), term));
    } catch (error) {
      this.logger.warn(
        `Subscription notification for ${subscriptionId} skipped: ${(error as Error).message}`,
      );
    }
  }

  private loadTerm(subscriptionId: string) {
    return this.prisma.agentSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: { select: { name: true } },
        agentProfile: { select: { user: { select: { email: true, fullName: true } } } },
      },
    });
  }
}

const firstName = (fullName: string) => fullName.split(' ')[0] || fullName;
