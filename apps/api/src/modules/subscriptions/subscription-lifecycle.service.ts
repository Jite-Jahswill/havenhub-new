import { Injectable } from '@nestjs/common';
import { AgentSubscriptionStatus as S } from '@havenhub/shared';

import type { RequestMeta } from '../../common/http/request-meta';
import type { AgentSubscription, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService } from '../plans/plan-limits.service';

type Tx = Prisma.TransactionClient;

/** Something an agent should hear about once the transaction commits. */
export type TermEvent =
  | { type: 'started'; subscriptionId: string }
  | { type: 'ended'; subscriptionId: string; reason: string };

/**
 * Time-driven term transitions for one agent, applied under the agent's row
 * lock. Safe to run any number of times, from anywhere (the sweep, a
 * checkout settling, an admin action): each step re-reads the rows and only
 * moves terms whose time has actually come.
 *
 *   ACTIVE/SUSPENDED past their end → EXPIRED (or CANCELLED if the agent
 *                                     asked to stop at period end)
 *   PENDING whose start has come    → ACTIVE (or straight to EXPIRED if its
 *                                     whole period already passed)
 *
 * Whenever the plan in force may have shrunk, featured listings beyond the
 * new allowance are released. Nothing else changes: listings, media,
 * bookings and payments are never touched by subscription changes.
 */
@Injectable()
export class SubscriptionLifecycleService {
  constructor(
    private readonly limits: PlanLimitsService,
    private readonly audit: AuditService,
  ) {}

  async lockAgent(tx: Tx, agentProfileId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM agent_profiles WHERE id = ${agentProfileId}::uuid FOR UPDATE`;
  }

  async reconcile(tx: Tx, agentProfileId: string, now = new Date()): Promise<TermEvent[]> {
    await this.lockAgent(tx, agentProfileId);
    const events: TermEvent[] = [];

    const finished = await tx.agentSubscription.findMany({
      where: {
        agentProfileId,
        status: { in: [S.ACTIVE, S.SUSPENDED] },
        currentPeriodEnd: { lte: now },
      },
    });
    for (const term of finished) {
      const cancelled = term.cancelAtPeriodEnd;
      const reason = cancelled
        ? 'You cancelled this plan, and its paid term has now ended.'
        : 'Its paid term has ended. Plans do not renew automatically.';
      await this.end(tx, term, cancelled ? S.CANCELLED : S.EXPIRED, {
        actorId: null,
        endedAt: term.currentPeriodEnd,
        endReason: cancelled ? 'Cancelled at the end of the paid term' : 'Paid term ended',
      });
      if (term.status === S.ACTIVE) events.push({ type: 'ended', subscriptionId: term.id, reason });
    }

    const due = await tx.agentSubscription.findMany({
      where: { agentProfileId, status: S.PENDING, currentPeriodStart: { lte: now } },
      orderBy: { currentPeriodStart: 'asc' },
    });
    for (const term of due) {
      if (term.currentPeriodEnd <= now) {
        await tx.agentSubscription.update({
          where: { id: term.id },
          data: {
            status: S.EXPIRED,
            startedAt: term.currentPeriodStart,
            endedAt: term.currentPeriodEnd,
            endReason: 'Paid term ended',
          },
        });
        await this.record(tx, term, 'subscription.expired', null, { status: S.EXPIRED });
        continue;
      }
      const active = await tx.agentSubscription.count({
        where: { agentProfileId, status: S.ACTIVE },
      });
      if (active > 0) continue; // an upgrade took over; this term waits for it to end
      await tx.agentSubscription.update({
        where: { id: term.id },
        data: { status: S.ACTIVE, startedAt: term.currentPeriodStart },
      });
      await this.record(tx, term, 'subscription.activated', null, {
        status: S.ACTIVE,
        changeType: term.changeType,
      });
      events.push({ type: 'started', subscriptionId: term.id });
    }

    if (events.length > 0) await this.releaseFeatured(tx, agentProfileId, null);
    // A term that hands straight over to the next one is not "ended" for the agent.
    return events.some((e) => e.type === 'started')
      ? events.filter((e) => e.type === 'started')
      : events;
  }

  /** Ends a term now (or at `endedAt`) with a final status. Caller holds the agent lock. */
  async end(
    tx: Tx,
    term: AgentSubscription,
    status: typeof S.CANCELLED | typeof S.EXPIRED,
    options: {
      actorId: string | null;
      endReason: string;
      endedAt?: Date;
      meta?: RequestMeta;
    },
  ): Promise<void> {
    const endedAt = options.endedAt ?? new Date();
    await tx.agentSubscription.update({
      where: { id: term.id },
      data: {
        status,
        endedAt,
        endReason: options.endReason.slice(0, 200),
        ...(status === S.CANCELLED && !term.cancelledAt ? { cancelledAt: endedAt } : {}),
      },
    });
    await this.record(
      tx,
      term,
      status === S.CANCELLED ? 'subscription.cancelled' : 'subscription.expired',
      options.actorId,
      { status, endReason: options.endReason },
      options.meta,
    );
  }

  async releaseFeatured(tx: Tx, agentProfileId: string, actorId: string | null): Promise<void> {
    const released = await this.limits.releaseExcessFeatured(tx, agentProfileId);
    if (released.length === 0) return;
    await this.audit.record(
      {
        actorId,
        action: 'property.unfeatured',
        resourceType: 'agent_profile',
        resourceId: agentProfileId,
        after: { propertyIds: released, reason: 'Featured allowance of the plan in force' },
      },
      tx,
    );
  }

  record(
    tx: Tx,
    term: AgentSubscription,
    action: string,
    actorId: string | null,
    after: Record<string, string | boolean | null>,
    meta?: RequestMeta,
  ): Promise<void> {
    return this.audit.record(
      {
        actorId,
        action,
        resourceType: 'agent_subscription',
        resourceId: term.id,
        before: { status: term.status },
        after: { agentProfileId: term.agentProfileId, planId: term.planId, ...after },
        meta,
      },
      tx,
    );
  }
}
