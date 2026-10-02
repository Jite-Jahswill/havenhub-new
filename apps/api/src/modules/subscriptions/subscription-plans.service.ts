import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AgentSubscriptionStatus,
  ErrorCode,
  SubscriptionPlanStatus,
  type AdminSubscriptionPlanView,
  type CreateSubscriptionPlanInput,
  type PlanEntitlements,
  type SubscriptionPlanView,
  type createSubscriptionPlanSchema,
  type updateSubscriptionPlanSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { entitlementsOf } from '../plans/entitlements';
import { PlanLimitsService, type PlanWithEntitlements } from '../plans/plan-limits.service';
import { PLAN_INCLUDE, toPlanView } from './subscription.mapper';

type CreateInput = z.output<typeof createSubscriptionPlanSchema>;
type UpdateInput = z.output<typeof updateSubscriptionPlanSchema>;

/**
 * Admin-managed plans. Plans are never hard-deleted once anyone has paid for
 * them — they are deactivated or archived, so history and receipts stay
 * intact. The free default plan can be edited (limits, copy) but keeps a
 * zero price and cannot be deactivated.
 */
@Injectable()
export class SubscriptionPlansService {
  private readonly logger = new Logger(SubscriptionPlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
  ) {}

  /** Plans an agent can choose from (the default plan included), cheapest tier first. */
  async offered(): Promise<SubscriptionPlanView[]> {
    const rows = await this.prisma.subscriptionPlan.findMany({
      where: { status: SubscriptionPlanStatus.ACTIVE },
      orderBy: [{ rank: 'asc' }, { priceKobo: 'asc' }],
      include: PLAN_INCLUDE,
    });
    return rows.map(toPlanView);
  }

  async adminList(): Promise<AdminSubscriptionPlanView[]> {
    const rows = await this.prisma.subscriptionPlan.findMany({
      orderBy: [{ isDefault: 'desc' }, { rank: 'asc' }, { createdAt: 'asc' }],
      include: PLAN_INCLUDE,
    });
    return this.withCounts(rows);
  }

  async adminGet(id: string): Promise<AdminSubscriptionPlanView> {
    const row = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
      include: PLAN_INCLUDE,
    });
    if (!row) throw Errors.notFound('Plan');
    return (await this.withCounts([row]))[0]!;
  }

  async create(
    actorId: string,
    input: CreateInput,
    meta: RequestMeta,
  ): Promise<AdminSubscriptionPlanView> {
    const slug = input.slug ?? slugify(input.name);
    try {
      const plan = await this.prisma.$transaction(async (tx) => {
        const created = await tx.subscriptionPlan.create({
          data: {
            slug,
            name: input.name,
            description: input.description ?? null,
            status: input.status,
            priceKobo: BigInt(input.priceKobo),
            billingInterval: input.billingInterval,
            rank: input.rank,
            features: input.features,
            createdById: actorId,
            entitlements: { create: entitlementRows(input.entitlements) },
          },
          include: PLAN_INCLUDE,
        });
        await this.audit.record(
          {
            actorId,
            action: 'subscription_plan.created',
            resourceType: 'subscription_plan',
            resourceId: created.id,
            after: snapshot(created),
            meta,
          },
          tx,
        );
        return created;
      });
      return this.adminGet(plan.id);
    } catch (error) {
      throw uniqueSlug(error, slug);
    }
  }

  async update(
    actorId: string,
    id: string,
    input: UpdateInput,
    meta: RequestMeta,
  ): Promise<AdminSubscriptionPlanView> {
    let limitsChanged = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM subscription_plans WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.subscriptionPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
      if (!before) throw Errors.notFound('Plan');
      if (before.isDefault && (input.priceKobo !== undefined || input.billingInterval)) {
        throw Errors.badRequest('The free default plan has no price or billing interval.');
      }
      if (before.status === SubscriptionPlanStatus.ARCHIVED) {
        throw Errors.conflict('Archived plans cannot be edited. Create a new plan instead.');
      }
      const { entitlements, priceKobo, ...fields } = input;
      if (entitlements) {
        const old = entitlementsOf(before);
        limitsChanged = Object.entries(entitlements).some(
          ([k, v]) => old[k as keyof PlanEntitlements] !== v,
        );
        await tx.subscriptionPlanEntitlement.deleteMany({ where: { planId: id } });
        await tx.subscriptionPlanEntitlement.createMany({
          data: entitlementRows(entitlements).map((row) => ({ ...row, planId: id })),
        });
      }
      const after = await tx.subscriptionPlan.update({
        where: { id },
        data: {
          ...fields,
          ...(priceKobo !== undefined ? { priceKobo: BigInt(priceKobo) } : {}),
        },
        include: PLAN_INCLUDE,
      });
      await this.audit.record(
        {
          actorId,
          action: limitsChanged ? 'subscription_plan.limits_changed' : 'subscription_plan.updated',
          resourceType: 'subscription_plan',
          resourceId: id,
          before: snapshot(before),
          after: snapshot(after),
          meta,
        },
        tx,
      );
    });
    if (limitsChanged) await this.releaseFeaturedAfterLimitChange(actorId);
    return this.adminGet(id);
  }

  async setStatus(
    actorId: string,
    id: string,
    status: SubscriptionPlanStatus,
    meta: RequestMeta,
  ): Promise<AdminSubscriptionPlanView> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM subscription_plans WHERE id = ${id}::uuid FOR UPDATE`;
      const plan = await tx.subscriptionPlan.findUnique({ where: { id } });
      if (!plan) throw Errors.notFound('Plan');
      if (plan.isDefault && status !== SubscriptionPlanStatus.ACTIVE) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          'The free default plan is always offered; edit its limits instead.',
        );
      }
      if (plan.status === SubscriptionPlanStatus.ARCHIVED && status !== plan.status) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          'Archived plans cannot be reactivated. Create a new plan instead.',
        );
      }
      if (plan.status === status) return;
      await tx.subscriptionPlan.update({ where: { id }, data: { status } });
      await this.audit.record(
        {
          actorId,
          action: `subscription_plan.${status.toLowerCase()}`,
          resourceType: 'subscription_plan',
          resourceId: id,
          before: { status: plan.status },
          after: { status },
          meta,
        },
        tx,
      );
    });
    return this.adminGet(id);
  }

  /** Only plans nobody has ever paid for may be deleted; the rest are archived. */
  async delete(actorId: string, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM subscription_plans WHERE id = ${id}::uuid FOR UPDATE`;
      const plan = await tx.subscriptionPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
      if (!plan) throw Errors.notFound('Plan');
      const [terms, payments] = await Promise.all([
        tx.agentSubscription.count({ where: { planId: id } }),
        tx.subscriptionPayment.count({ where: { planId: id } }),
      ]);
      if (plan.isDefault || terms > 0 || payments > 0) {
        throw Errors.conflict(
          plan.isDefault
            ? 'The free default plan cannot be deleted.'
            : 'This plan has subscription or payment history. Archive it instead.',
        );
      }
      await tx.subscriptionPlan.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'subscription_plan.deleted',
          resourceType: 'subscription_plan',
          resourceId: id,
          before: snapshot(plan),
          meta,
        },
        tx,
      );
    });
  }

  /**
   * Lowered featured allowances take effect at once: listings featured
   * beyond the new limit are un-featured (never hidden or removed). Only
   * agents with featured listings can be affected.
   */
  private async releaseFeaturedAfterLimitChange(actorId: string): Promise<void> {
    const agents = await this.prisma.property.findMany({
      where: { featuredAt: { not: null } },
      distinct: ['agentProfileId'],
      select: { agentProfileId: true },
    });
    for (const { agentProfileId } of agents) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const released = await this.limits.releaseExcessFeatured(tx, agentProfileId);
          if (released.length === 0) return;
          await this.audit.record(
            {
              actorId,
              action: 'property.unfeatured',
              resourceType: 'agent_profile',
              resourceId: agentProfileId,
              after: { propertyIds: released, reason: 'Plan featured allowance lowered' },
            },
            tx,
          );
        });
      } catch (error) {
        this.logger.error(
          `Could not re-apply featured limit for agent ${agentProfileId}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async withCounts(rows: PlanWithEntitlements[]): Promise<AdminSubscriptionPlanView[]> {
    const ids = rows.map((r) => r.id);
    const [active, total, paid] = await Promise.all([
      this.prisma.agentSubscription.groupBy({
        by: ['planId'],
        where: { planId: { in: ids }, status: AgentSubscriptionStatus.ACTIVE },
        _count: { _all: true },
      }),
      this.prisma.agentSubscription.groupBy({
        by: ['planId'],
        where: { planId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.subscriptionPayment.groupBy({
        by: ['planId'],
        where: { planId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const count = (list: { planId: string; _count: { _all: number } }[], id: string) =>
      list.find((r) => r.planId === id)?._count._all ?? 0;
    const agentsOnDefault = rows.some((r) => r.isDefault)
      ? (await this.prisma.agentProfile.count()) -
        (await this.prisma.agentSubscription.count({
          where: { status: AgentSubscriptionStatus.ACTIVE },
        }))
      : 0;
    return rows.map((row) => ({
      ...toPlanView(row),
      activeSubscribers: row.isDefault ? agentsOnDefault : count(active, row.id),
      totalSubscriptions: count(total, row.id),
      canDelete: !row.isDefault && count(total, row.id) === 0 && count(paid, row.id) === 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}

const entitlementRows = (entitlements: PlanEntitlements) =>
  Object.entries(entitlements).map(([key, limit]) => ({
    key: key as keyof PlanEntitlements,
    limit,
  }));

const snapshot = (p: PlanWithEntitlements) => ({
  slug: p.slug,
  name: p.name,
  status: p.status,
  priceKobo: p.priceKobo.toString(),
  billingInterval: p.billingInterval,
  rank: p.rank,
  entitlements: entitlementsOf(p),
});

export const slugify = (name: CreateSubscriptionPlanInput['name']) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'plan';

function uniqueSlug(error: unknown, slug: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return Errors.conflict(`A plan with the slug "${slug}" already exists.`);
  }
  return error;
}
