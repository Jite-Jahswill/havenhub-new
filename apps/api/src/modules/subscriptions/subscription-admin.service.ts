import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AgentSubscriptionStatus as S,
  ErrorCode,
  PaymentStatus,
  type AdminSubscriptionActionInput,
  type AdminSubscriptionDetail,
  type AdminSubscriptionListItem,
  type Paginated,
  type SubscriptionStatsView,
  type adminListSubscriptionsQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import { paginate } from '../../common/http/response';
import type { RequestMeta } from '../../common/http/request-meta';
import { koboToNumber } from '../../common/money';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SubscriptionLifecycleService, type TermEvent } from './subscription-lifecycle.service';
import { TERM_INCLUDE, toSubscriptionPaymentView, toSubscriptionView } from './subscription.mapper';
import { SubscriptionsService } from './subscriptions.service';

const ADMIN_INCLUDE = {
  ...TERM_INCLUDE,
  agentProfile: {
    select: {
      id: true,
      userId: true,
      businessName: true,
      user: { select: { fullName: true, email: true } },
    },
  },
} as const;

type AdminRow = Prisma.AgentSubscriptionGetPayload<{ include: typeof ADMIN_INCLUDE }>;

const DAY_MS = 24 * 3600 * 1000;

@Injectable()
export class SubscriptionAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async list(
    query: z.output<typeof adminListSubscriptionsQuerySchema>,
  ): Promise<Paginated<AdminSubscriptionListItem>> {
    const search = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.AgentSubscriptionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.planId ? { planId: query.planId } : {}),
      ...(search
        ? {
            agentProfile: {
              OR: [
                { businessName: search },
                { user: { fullName: search } },
                { user: { email: search } },
              ],
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.agentSubscription.count({ where }),
      this.prisma.agentSubscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: ADMIN_INCLUDE,
      }),
    ]);
    return paginate(rows.map(toAdminItem), query.page, query.pageSize, total);
  }

  async detail(id: string): Promise<AdminSubscriptionDetail> {
    const row = await this.prisma.agentSubscription.findUnique({
      where: { id },
      include: { ...ADMIN_INCLUDE, payments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!row) throw Errors.notFound('Subscription');
    return {
      ...toAdminItem(row),
      payments: row.payments.map(toSubscriptionPaymentView),
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
    };
  }

  /**
   * CANCEL ends a term now (no automatic refund). SUSPEND pauses it: the
   * agent falls back to the default plan while the paid period keeps
   * running. REACTIVATE lifts a suspension if the period has not ended.
   */
  async act(
    actorId: string,
    id: string,
    input: AdminSubscriptionActionInput,
    meta: RequestMeta,
  ): Promise<AdminSubscriptionDetail> {
    const head = await this.prisma.agentSubscription.findUnique({ where: { id } });
    if (!head) throw Errors.notFound('Subscription');
    const events = await this.prisma.$transaction(async (tx): Promise<TermEvent[]> => {
      const events = await this.lifecycle.reconcile(tx, head.agentProfileId);
      const term = await tx.agentSubscription.findUniqueOrThrow({ where: { id } });
      const refuse = (message: string) =>
        new AppException(HttpStatus.CONFLICT, ErrorCode.INVALID_STATUS_TRANSITION, message);

      if (input.action === 'CANCEL') {
        const cancellable: string[] = [S.ACTIVE, S.SUSPENDED, S.PENDING];
        if (!cancellable.includes(term.status)) {
          throw refuse(`A ${term.status.toLowerCase()} subscription cannot be cancelled.`);
        }
        await this.lifecycle.end(tx, term, S.CANCELLED, {
          actorId,
          endReason: `Cancelled by HavenHub: ${input.reason}`,
          meta,
        });
        await this.lifecycle.releaseFeatured(tx, term.agentProfileId, actorId);
        return term.status === S.ACTIVE
          ? [
              ...events,
              {
                type: 'ended',
                subscriptionId: term.id,
                reason: `HavenHub cancelled this plan: ${input.reason}`,
              },
            ]
          : events;
      }

      if (input.action === 'SUSPEND') {
        if (term.status !== S.ACTIVE) throw refuse('Only active subscriptions can be suspended.');
        await tx.agentSubscription.update({
          where: { id },
          data: { status: S.SUSPENDED, suspendedAt: new Date() },
        });
        await this.lifecycle.record(
          tx,
          term,
          'subscription.suspended',
          actorId,
          { status: S.SUSPENDED, reason: input.reason },
          meta,
        );
        await this.lifecycle.releaseFeatured(tx, term.agentProfileId, actorId);
        return [
          ...events,
          {
            type: 'ended',
            subscriptionId: term.id,
            reason: `HavenHub suspended this plan: ${input.reason}`,
          },
        ];
      }

      if (term.status !== S.SUSPENDED)
        throw refuse('Only suspended subscriptions can be reactivated.');
      if (term.currentPeriodEnd <= new Date())
        throw refuse('This subscription’s period has ended.');
      const active = await tx.agentSubscription.count({
        where: { agentProfileId: term.agentProfileId, status: S.ACTIVE },
      });
      if (active > 0) throw refuse('The agent already has another active subscription.');
      await tx.agentSubscription.update({
        where: { id },
        data: { status: S.ACTIVE, suspendedAt: null },
      });
      await this.lifecycle.record(
        tx,
        term,
        'subscription.reactivated',
        actorId,
        { status: S.ACTIVE, reason: input.reason },
        meta,
      );
      return [...events, { type: 'started', subscriptionId: term.id }];
    });
    await this.subscriptions.notify(events, head.agentProfileId);
    return this.detail(id);
  }

  /** Every figure is counted from stored rows; nothing is estimated. */
  async stats(): Promise<SubscriptionStatsView> {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const [
      agents,
      active,
      byStatus,
      revenue,
      recentRevenue,
      recent,
      plans,
      revenueByPlan,
      activeByPlan,
    ] = await Promise.all([
      this.prisma.agentProfile.count(),
      this.prisma.agentSubscription.count({
        where: { status: S.ACTIVE, currentPeriodEnd: { gt: now } },
      }),
      this.prisma.agentSubscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.subscriptionPayment.aggregate({
        where: { status: PaymentStatus.SUCCESS },
        _sum: { amountKobo: true },
      }),
      this.prisma.subscriptionPayment.aggregate({
        where: { status: PaymentStatus.SUCCESS, paidAt: { gte: since } },
        _sum: { amountKobo: true },
      }),
      this.prisma.agentSubscription.groupBy({
        by: ['changeType'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.subscriptionPlan.findMany({
        orderBy: [{ isDefault: 'desc' }, { rank: 'asc' }],
        select: { id: true, name: true, isDefault: true },
      }),
      this.prisma.subscriptionPayment.groupBy({
        by: ['planId'],
        where: { status: PaymentStatus.SUCCESS },
        _sum: { amountKobo: true },
      }),
      this.prisma.agentSubscription.groupBy({
        by: ['planId'],
        where: { status: S.ACTIVE, currentPeriodEnd: { gt: now } },
        _count: { _all: true },
      }),
    ]);
    const status = (s: S) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const changes = (c: string) => recent.find((r) => r.changeType === c)?._count._all ?? 0;
    return {
      agents,
      paidAgents: active,
      freeAgents: agents - active,
      byStatus: {
        PENDING: status(S.PENDING),
        ACTIVE: status(S.ACTIVE),
        CANCELLED: status(S.CANCELLED),
        EXPIRED: status(S.EXPIRED),
        SUSPENDED: status(S.SUSPENDED),
      },
      revenueKobo: koboToNumber(revenue._sum.amountKobo ?? 0n),
      revenueLast30DaysKobo: koboToNumber(recentRevenue._sum.amountKobo ?? 0n),
      last30Days: {
        new: changes('NEW'),
        renewals: changes('RENEWAL'),
        upgrades: changes('UPGRADE'),
        downgrades: changes('DOWNGRADE'),
      },
      byPlan: plans.map((p) => ({
        planId: p.id,
        name: p.name,
        isDefault: p.isDefault,
        activeSubscribers: p.isDefault
          ? agents - active
          : (activeByPlan.find((r) => r.planId === p.id)?._count._all ?? 0),
        revenueKobo: koboToNumber(
          revenueByPlan.find((r) => r.planId === p.id)?._sum.amountKobo ?? 0n,
        ),
      })),
    };
  }
}

const toAdminItem = (row: AdminRow): AdminSubscriptionListItem => ({
  ...toSubscriptionView(row),
  agent: {
    id: row.agentProfile.id,
    userId: row.agentProfile.userId,
    displayName: row.agentProfile.businessName ?? row.agentProfile.user.fullName,
    email: row.agentProfile.user.email,
  },
});
