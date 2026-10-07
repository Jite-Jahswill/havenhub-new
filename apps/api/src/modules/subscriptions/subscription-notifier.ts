import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@havenhub/shared';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { MailService } from '../../infrastructure/mail/mail.service';
import { MailTemplates } from '../../infrastructure/mail/mail.templates';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatDay } from './subscription.mapper';

/**
 * Subscription notifications: an in-app entry and an email. Called after the
 * change has committed; a delivery problem is logged and never undoes or
 * fails the change itself.
 */
@Injectable()
export class SubscriptionNotifier {
  private readonly logger = new Logger(SubscriptionNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationsService,
  ) {}

  private get subscriptionUrl() {
    return `${this.env.WEB_APP_URL}/agent/subscription`;
  }

  private get plansUrl() {
    return `${this.env.WEB_APP_URL}/agent/subscription/plans`;
  }

  async started(subscriptionId: string): Promise<void> {
    await this.withTerm(
      subscriptionId,
      (to, name, term) =>
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
      (term) =>
        term.status === 'ACTIVE'
          ? {
              title: `${term.plan.name} plan active`,
              body: `Your ${term.plan.name} plan is active until ${formatDay(term.currentPeriodEnd)}.`,
            }
          : {
              title: `${term.plan.name} plan scheduled`,
              body: `Your ${term.plan.name} plan starts on ${formatDay(term.currentPeriodStart)}.`,
            },
    );
  }

  async expiring(subscriptionId: string): Promise<void> {
    await this.withTerm(
      subscriptionId,
      (to, name, term) =>
        MailTemplates.subscriptionExpiring(
          to,
          name,
          term.plan.name,
          formatDay(term.currentPeriodEnd),
          this.plansUrl,
        ),
      (term) => ({
        title: 'Your plan ends soon',
        body: `Your ${term.plan.name} plan ends on ${formatDay(term.currentPeriodEnd)}. Renew to keep its limits and features.`,
        link: '/agent/subscription/plans',
      }),
    );
  }

  async ended(subscriptionId: string, reason: string, fallbackPlan: string): Promise<void> {
    await this.withTerm(
      subscriptionId,
      (to, name, term) =>
        MailTemplates.subscriptionEnded(
          to,
          name,
          term.plan.name,
          reason,
          fallbackPlan,
          this.plansUrl,
        ),
      (term) => ({
        title: `${term.plan.name} plan ended`,
        body: `Your ${term.plan.name} plan ended (${reason}). You are now on ${fallbackPlan}.`,
        link: '/agent/subscription/plans',
      }),
    );
  }

  async paymentFailed(agentProfileId: string, planName: string): Promise<void> {
    try {
      const agent = await this.prisma.agentProfile.findUnique({
        where: { id: agentProfileId },
        select: { user: { select: { id: true, email: true, fullName: true } } },
      });
      if (!agent) return;
      await this.notifications.notify(this.prisma, [
        {
          userId: agent.user.id,
          type: NotificationType.SUBSCRIPTION,
          title: 'Subscription payment failed',
          body: `Your payment for the ${planName} plan did not go through. Nothing was charged; try again from your subscription page.`,
          link: '/agent/subscription/plans',
        },
      ]);
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
    inApp: (term: NonNullable<Awaited<ReturnType<SubscriptionNotifier['loadTerm']>>>) => {
      title: string;
      body: string;
      link?: string;
    },
  ): Promise<void> {
    try {
      const term = await this.loadTerm(subscriptionId);
      if (!term) return;
      const user = term.agentProfile.user;
      const entry = inApp(term);
      await this.notifications.notify(this.prisma, [
        {
          userId: user.id,
          type: NotificationType.SUBSCRIPTION,
          title: entry.title,
          body: entry.body,
          link: entry.link ?? '/agent/subscription',
        },
      ]);
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
        agentProfile: { select: { user: { select: { id: true, email: true, fullName: true } } } },
      },
    });
  }
}

const firstName = (fullName: string) => fullName.split(' ')[0] || fullName;
