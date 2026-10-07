import { randomBytes } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AgentSubscriptionStatus as S,
  ENTITLEMENTS,
  ErrorCode,
  PaymentStatus,
  SubscriptionPlanStatus,
  type AgentSubscriptionView,
  type CancelSubscriptionInput,
  type CurrentSubscriptionView,
  type SubscriptionCheckoutView,
  type SubscriptionPaymentVerificationView,
  type SubscriptionPaymentView,
  type SubscriptionQuoteView,
  type SubscriptionTestCheckoutView,
} from '@havenhub/shared';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { koboToNumber } from '../../common/money';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { AgentProfile, Prisma, SubscriptionPayment } from '../../generated/prisma/client';
import { describeError } from '../../common/logging/describe-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  PaymentProviderError,
  verificationMismatch,
  type ProviderVerification,
} from '../finance/providers/payment-provider';
import { PaymentProviders } from '../finance/providers/payment-providers.service';
import { TestPaymentProvider } from '../finance/providers/test-payment.provider';
import { entitlementsOf } from '../plans/entitlements';
import { PlanLimitsService, type PlanWithEntitlements } from '../plans/plan-limits.service';
import { PlanUsageService } from '../plans/plan-usage.service';
import { RESTRICTED_AGENT_STATUSES } from '../properties/property-lifecycle';
import { changeNotes, planChange, type BillingTerm } from './subscription-billing';
import { SubscriptionLifecycleService, type TermEvent } from './subscription-lifecycle.service';
import {
  PLAN_INCLUDE,
  TERM_INCLUDE,
  formatDay,
  toPlanView,
  toSubscriptionPaymentView,
  toSubscriptionView,
} from './subscription.mapper';
import { SubscriptionNotifier } from './subscription-notifier';
import { DiscountsService } from '../discounts/discounts.service';

type Tx = Prisma.TransactionClient;

/**
 * An agent's own subscription: what applies now, what a change would cost,
 * checkout, settlement and cancellation. Every method is scoped to the
 * signed-in agent — there is no id an agent could change to reach another
 * agent's subscription.
 *
 * Paid entitlements are granted only by `settle`, which trusts nothing but
 * the provider's server-side verification (reference, amount, currency) and
 * is idempotent under a row lock: however many redirects or webhooks arrive,
 * a payment buys exactly one term.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: PlanLimitsService,
    private readonly usage: PlanUsageService,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly providers: PaymentProviders,
    private readonly testProvider: TestPaymentProvider,
    private readonly notifier: SubscriptionNotifier,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    private readonly discounts: DiscountsService,
  ) {}

  async agentFor(userId: string): Promise<AgentProfile> {
    const agent = await this.prisma.agentProfile.findUnique({ where: { userId } });
    if (!agent) throw Errors.notFound('Agent profile');
    return agent;
  }

  async current(userId: string): Promise<CurrentSubscriptionView> {
    const agent = await this.agentFor(userId);
    const now = new Date();
    const [effective, scheduled] = await Promise.all([
      this.limits.effectivePlan(agent.id),
      this.prisma.agentSubscription.findFirst({
        where: { agentProfileId: agent.id, status: S.PENDING, currentPeriodStart: { gt: now } },
        orderBy: { currentPeriodStart: 'asc' },
        include: TERM_INCLUDE,
      }),
    ]);
    const usage = await this.usage.usage(agent.id, effective.limits);
    const term = effective.subscription
      ? await this.prisma.agentSubscription.findUniqueOrThrow({
          where: { id: effective.subscription.id },
          include: TERM_INCLUDE,
        })
      : null;
    return {
      plan: toPlanView(effective.plan),
      subscription: term ? toSubscriptionView(term) : null,
      scheduled: scheduled ? toSubscriptionView(scheduled) : null,
      usage,
      overLimit: PlanUsageService.overLimit(usage),
    };
  }

  async quote(userId: string, planId: string, code?: string): Promise<SubscriptionQuoteView> {
    const agent = await this.agentFor(userId);
    return this.quoteFor(agent, planId, code);
  }

  async checkout(
    user: { id: string; email: string },
    planId: string,
    code: string | undefined,
    meta: RequestMeta,
  ): Promise<SubscriptionCheckoutView> {
    const agent = await this.agentFor(user.id);
    if (RESTRICTED_AGENT_STATUSES.includes(agent.verificationStatus)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.AGENT_RESTRICTED,
        'Your agent account is restricted. Please contact support.',
      );
    }
    // Priced by the server from the plan record; nothing about the amount comes from the client.
    const quote = await this.quoteFor(agent, planId, code);
    const provider = this.providers.active();
    const payment = await this.prisma.$transaction(async (tx) => {
      // Re-checked under a lock on the code, so its last use cannot be taken twice.
      const discount = code
        ? await this.discounts.apply(tx, {
            code,
            userId: user.id,
            target: {
              kind: 'PLAN',
              agentProfileId: agent.id,
              planId: quote.plan.id,
              planName: quote.plan.name,
            },
            priceKobo: quote.listPriceKobo,
            lock: true,
          })
        : null;
      const amountOff = discount?.applied.amountOffKobo ?? 0;
      const created = await tx.subscriptionPayment.create({
        data: {
          agentProfileId: agent.id,
          planId: quote.plan.id,
          provider: provider.name,
          reference: `HHS-${randomBytes(12).toString('hex')}`,
          amountKobo: BigInt(quote.listPriceKobo - amountOff),
          discountKobo: BigInt(amountOff),
          discountCode: discount?.applied.code ?? null,
          currency: quote.plan.currency,
          billingInterval: quote.plan.billingInterval!,
          planName: quote.plan.name,
        },
      });
      if (discount) {
        await this.discounts.reserve(tx, {
          discountCodeId: discount.discountCodeId,
          userId: user.id,
          subscriptionPaymentId: created.id,
          amountOffKobo: amountOff,
        });
      }
      await this.audit.record(
        {
          actorId: user.id,
          action: 'subscription_payment.initiated',
          resourceType: 'subscription_payment',
          resourceId: created.id,
          after: {
            reference: created.reference,
            planId: created.planId,
            provider: created.provider,
            amountKobo: created.amountKobo.toString(),
            discountKobo: created.discountKobo.toString(),
            discountCode: created.discountCode,
            changeType: quote.changeType,
          },
          meta,
        },
        tx,
      );
      return created;
    });

    try {
      const { authorizationUrl } = await provider.initialize({
        reference: payment.reference,
        amountKobo: payment.amountKobo,
        currency: 'NGN',
        email: user.email,
        callbackUrl: `${this.env.WEB_APP_URL}/agent/subscription/payment`,
        metadata: { purpose: 'subscription', agentProfileId: agent.id, planId: payment.planId },
      });
      return {
        reference: payment.reference,
        provider: payment.provider,
        authorizationUrl,
        amountKobo: koboToNumber(payment.amountKobo),
        quote: { ...quote, amountKobo: koboToNumber(payment.amountKobo) },
      };
    } catch (error) {
      this.logger.error('Could not start a payment with the provider', {
        event: 'payment.initiate_failed',
        kind: 'subscription',
        reference: payment.reference,
        ...describeError(error),
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.subscriptionPayment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, failureReason: 'Could not start the payment' },
        });
        await this.discounts.settle(tx, { subscriptionPaymentId: payment.id }, 'RELEASED');
      });
      throw new AppException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        'We could not start the payment. Please try again in a moment.',
      );
    }
  }

  /** The agent returned from checkout: verify their own payment. */
  async verifyForAgent(
    userId: string,
    reference: string,
  ): Promise<SubscriptionPaymentVerificationView> {
    const owned = await this.prisma.subscriptionPayment.findFirst({
      where: { reference, agentProfile: { userId } },
      select: { id: true },
    });
    if (!owned) throw Errors.notFound('Payment');
    return this.settle(reference);
  }

  /** Settles one subscription payment from the provider's own record. Idempotent. */
  async settle(reference: string): Promise<SubscriptionPaymentVerificationView> {
    const payment = await this.prisma.subscriptionPayment.findUnique({ where: { reference } });
    if (!payment) throw Errors.notFound('Payment');
    if (payment.status !== PaymentStatus.PENDING) return this.view(payment.id);

    let verification: ProviderVerification;
    try {
      verification = await this.providers.get(payment.provider).verify(reference);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        this.logger.warn('Payment verification with the provider failed', {
          event: 'payment.verification_failed',
          kind: 'subscription',
          reference,
          outcomeUnknown: error.outcomeUnknown,
          ...describeError(error),
        });
        throw new AppException(
          HttpStatus.BAD_GATEWAY,
          ErrorCode.PAYMENT_VERIFICATION_FAILED,
          'We could not confirm this payment with the payment provider yet. Please try again shortly.',
        );
      }
      throw error;
    }
    if (verification.status === 'pending') return this.view(payment.id);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM subscription_payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const current = await tx.subscriptionPayment.findUniqueOrThrow({ where: { id: payment.id } });
      if (current.status !== PaymentStatus.PENDING) return null; // settled concurrently

      if (verification.status === 'failed') {
        await this.markFailed(tx, current, verification.message ?? 'Payment was not completed');
        return { failed: true as const };
      }
      const mismatch = verificationMismatch(current, verification);
      if (mismatch) {
        await this.markFailed(
          tx,
          current,
          `Verification mismatch: ${mismatch}`,
          'subscription_payment.verification_mismatch',
        );
        return { failed: true as const };
      }
      const now = new Date();
      await tx.subscriptionPayment.update({
        where: { id: current.id },
        data: {
          status: PaymentStatus.SUCCESS,
          providerTransactionId: verification.providerTransactionId,
          paidAt: verification.paidAt ?? now,
          verifiedAt: now,
          failureReason: null,
        },
      });
      await this.audit.record(
        {
          actorId: null,
          action: 'subscription_payment.succeeded',
          resourceType: 'subscription_payment',
          resourceId: current.id,
          before: { status: current.status },
          after: { status: PaymentStatus.SUCCESS, amountKobo: current.amountKobo.toString() },
        },
        tx,
      );
      await this.discounts.settle(tx, { subscriptionPaymentId: current.id }, 'REDEEMED');
      return { failed: false as const, events: await this.apply(tx, current, now) };
    });

    if (outcome?.failed)
      await this.notifier.paymentFailed(payment.agentProfileId, payment.planName);
    if (outcome && !outcome.failed) await this.notify(outcome.events, payment.agentProfileId);
    return this.view(payment.id);
  }

  /**
   * Turns a verified payment into a term, under the agent's lock. Decided
   * from the agent's state *now* (not at checkout), so payments completed in
   * two tabs, or late, queue behind each other instead of overlapping.
   */
  private async apply(tx: Tx, payment: SubscriptionPayment, now: Date): Promise<TermEvent[]> {
    const events = await this.lifecycle.reconcile(tx, payment.agentProfileId, now);
    const plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { id: payment.planId } });
    const { current, queued } = await this.billingState(tx, payment.agentProfileId, now);
    const change = planChange(
      { id: plan.id, rank: plan.rank, billingInterval: payment.billingInterval },
      current && term(current),
      queued && term(queued),
      now,
    );
    if (change.replaces === 'current' && current) {
      await this.lifecycle.end(tx, current, S.CANCELLED, {
        actorId: null,
        endReason: `Upgraded to ${plan.name}`,
        endedAt: now,
      });
    }
    const created = await tx.agentSubscription.create({
      data: {
        agentProfileId: payment.agentProfileId,
        planId: plan.id,
        status: change.startsImmediately ? S.ACTIVE : S.PENDING,
        changeType: change.changeType,
        priceKobo: payment.amountKobo,
        currency: payment.currency,
        billingInterval: payment.billingInterval,
        currentPeriodStart: change.startsAt,
        currentPeriodEnd: change.endsAt,
        startedAt: change.startsImmediately ? now : null,
      },
    });
    await tx.subscriptionPayment.update({
      where: { id: payment.id },
      data: { subscriptionId: created.id },
    });
    await this.lifecycle.record(
      tx,
      created,
      change.startsImmediately ? 'subscription.activated' : 'subscription.scheduled',
      null,
      {
        status: created.status,
        changeType: change.changeType,
        paymentReference: payment.reference,
      },
    );
    if (change.replaces) await this.lifecycle.releaseFeatured(tx, payment.agentProfileId, null);
    return [
      ...events.filter((e) => e.type !== 'started'),
      { type: 'started', subscriptionId: created.id },
    ];
  }

  async cancel(
    userId: string,
    input: CancelSubscriptionInput,
    meta: RequestMeta,
  ): Promise<CurrentSubscriptionView> {
    const agent = await this.agentFor(userId);
    const events = await this.prisma.$transaction(async (tx) => {
      const events = await this.lifecycle.reconcile(tx, agent.id);
      const { current } = await this.billingState(tx, agent.id, new Date());
      if (!current) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          'You are on the free plan — there is no paid plan to cancel.',
        );
      }
      if (input.mode === 'IMMEDIATE') {
        await this.lifecycle.end(tx, current, S.CANCELLED, {
          actorId: userId,
          endReason: `Cancelled by the agent${input.reason ? `: ${input.reason}` : ''}`,
          meta,
        });
        await this.lifecycle.releaseFeatured(tx, agent.id, userId);
        return [
          ...events,
          {
            type: 'ended' as const,
            subscriptionId: current.id,
            reason:
              'You cancelled this plan with immediate effect. No refund is due for the unused time.',
          },
        ];
      }
      if (current.cancelAtPeriodEnd) return events; // already scheduled
      await tx.agentSubscription.update({
        where: { id: current.id },
        data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
      });
      await this.lifecycle.record(
        tx,
        current,
        'subscription.cancel_scheduled',
        userId,
        { cancelAtPeriodEnd: true, reason: input.reason ?? null },
        meta,
      );
      return events;
    });
    await this.notify(events, agent.id);
    return this.current(userId);
  }

  /** Withdraws an end-of-period cancellation while the term is still running. */
  async resume(userId: string, meta: RequestMeta): Promise<CurrentSubscriptionView> {
    const agent = await this.agentFor(userId);
    await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.reconcile(tx, agent.id);
      const { current } = await this.billingState(tx, agent.id, new Date());
      if (!current?.cancelAtPeriodEnd) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          'There is no scheduled cancellation to undo.',
        );
      }
      await tx.agentSubscription.update({
        where: { id: current.id },
        data: { cancelAtPeriodEnd: false, cancelledAt: null },
      });
      await this.lifecycle.record(
        tx,
        current,
        'subscription.resumed',
        userId,
        {
          cancelAtPeriodEnd: false,
        },
        meta,
      );
    });
    return this.current(userId);
  }

  async history(userId: string): Promise<AgentSubscriptionView[]> {
    const agent = await this.agentFor(userId);
    const rows = await this.prisma.agentSubscription.findMany({
      where: { agentProfileId: agent.id },
      orderBy: [{ currentPeriodStart: 'desc' }, { createdAt: 'desc' }],
      include: TERM_INCLUDE,
      take: 100,
    });
    return rows.map(toSubscriptionView);
  }

  async payments(userId: string): Promise<SubscriptionPaymentView[]> {
    const agent = await this.agentFor(userId);
    const rows = await this.prisma.subscriptionPayment.findMany({
      where: { agentProfileId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toSubscriptionPaymentView);
  }

  // ── Development test checkout ────────────────────────────────────────────

  async testCheckout(userId: string, reference: string): Promise<SubscriptionTestCheckoutView> {
    if (!this.providers.testProviderEnabled) throw Errors.notFound('Page');
    const p = await this.prisma.subscriptionPayment.findFirst({
      where: { reference, provider: 'TEST', agentProfile: { userId } },
    });
    if (!p) throw Errors.notFound('Payment');
    return {
      reference: p.reference,
      amountKobo: koboToNumber(p.amountKobo),
      planName: p.planName,
      billingInterval: p.billingInterval,
      status: p.status,
    };
  }

  /** Records the simulated outcome, then settles through the normal verification path. */
  async completeTestCheckout(
    userId: string,
    reference: string,
    outcome: 'success' | 'failed',
  ): Promise<SubscriptionPaymentVerificationView> {
    const view = await this.testCheckout(userId, reference);
    if (view.status === PaymentStatus.PENDING) await this.testProvider.simulate(reference, outcome);
    return this.settle(reference);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async quoteFor(
    agent: AgentProfile,
    planId: string,
    code?: string,
  ): Promise<SubscriptionQuoteView> {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      include: PLAN_INCLUDE,
    });
    if (!plan || plan.status !== SubscriptionPlanStatus.ACTIVE) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.PLAN_NOT_AVAILABLE,
        'This plan is not available.',
      );
    }
    if (plan.isDefault) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.PLAN_NOT_AVAILABLE,
        'The free plan needs no checkout. To move to it, cancel your paid plan.',
      );
    }
    const now = new Date();
    const { current, queued } = await this.billingState(this.prisma, agent.id, now);
    if (queued) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.SUBSCRIPTION_CHANGE_SCHEDULED,
        `Your ${queued.plan.name} plan is already paid for and starts on ${formatDay(queued.currentPeriodStart)}. You can choose another plan after it starts.`,
      );
    }
    const change = planChange(
      { id: plan.id, rank: plan.rank, billingInterval: plan.billingInterval! },
      current && term(current),
      null,
      now,
    );
    const listPriceKobo = koboToNumber(plan.priceKobo);
    const discount = code
      ? (
          await this.discounts.apply(this.prisma, {
            code,
            userId: agent.userId,
            target: {
              kind: 'PLAN',
              agentProfileId: agent.id,
              planId: plan.id,
              planName: plan.name,
            },
            priceKobo: listPriceKobo,
          })
        ).applied
      : null;
    return {
      plan: toPlanView(plan),
      changeType: change.changeType,
      amountKobo: listPriceKobo - (discount?.amountOffKobo ?? 0),
      listPriceKobo,
      discount,
      startsImmediately: change.startsImmediately,
      startsAt: change.startsAt.toISOString(),
      endsAt: change.endsAt.toISOString(),
      notes: changeNotes(
        change,
        current && { planName: current.plan.name, periodEnd: current.currentPeriodEnd },
        formatDay,
      ),
      overLimit: await this.overLimitOn(agent.id, plan),
    };
  }

  /** Where the agent's current usage exceeds `plan` — shown before a downgrade. */
  private async overLimitOn(agentProfileId: string, plan: PlanWithEntitlements) {
    const limits = entitlementsOf(plan);
    const usage = await this.usage.usage(agentProfileId, limits);
    return usage
      .filter((u) => u.used !== null && u.limit !== null && u.used > u.limit)
      .map((u) => ({
        key: u.key,
        label: ENTITLEMENTS.find((e) => e.key === u.key)!.label,
        used: u.used!,
        limit: u.limit!,
      }));
  }

  private async billingState(db: Tx | PrismaService, agentProfileId: string, now: Date) {
    const include = { plan: { select: { id: true, name: true, rank: true } } };
    const [current, queued] = await Promise.all([
      db.agentSubscription.findFirst({
        where: { agentProfileId, status: S.ACTIVE, currentPeriodEnd: { gt: now } },
        include,
      }),
      db.agentSubscription.findFirst({
        where: { agentProfileId, status: S.PENDING, currentPeriodEnd: { gt: now } },
        orderBy: { currentPeriodEnd: 'desc' },
        include,
      }),
    ]);
    return { current, queued };
  }

  private async markFailed(
    tx: Tx,
    payment: SubscriptionPayment,
    reason: string,
    action = 'subscription_payment.failed',
  ) {
    await tx.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureReason: reason.slice(0, 300),
        verifiedAt: new Date(),
      },
    });
    // A failed payment gives its discount use back.
    await this.discounts.settle(tx, { subscriptionPaymentId: payment.id }, 'RELEASED');
    await this.audit.record(
      {
        actorId: null,
        action,
        resourceType: 'subscription_payment',
        resourceId: payment.id,
        before: { status: payment.status },
        after: { status: PaymentStatus.FAILED, reason },
      },
      tx,
    );
  }

  async notify(events: TermEvent[], agentProfileId: string): Promise<void> {
    if (events.length === 0) return;
    const fallback = await this.limits.effectivePlan(agentProfileId).catch(() => null);
    for (const event of events) {
      if (event.type === 'started') await this.notifier.started(event.subscriptionId);
      else
        await this.notifier.ended(
          event.subscriptionId,
          event.reason,
          fallback?.plan.name ?? 'free',
        );
    }
  }

  private async view(paymentId: string): Promise<SubscriptionPaymentVerificationView> {
    const p = await this.prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { subscription: { include: TERM_INCLUDE } },
    });
    return {
      reference: p.reference,
      paymentStatus: p.status,
      subscription: p.subscription ? toSubscriptionView(p.subscription) : null,
    };
  }
}

const term = (t: {
  planId: string;
  plan: { rank: number };
  currentPeriodEnd: Date;
}): BillingTerm => ({
  planId: t.planId,
  rank: t.plan.rank,
  currentPeriodEnd: t.currentPeriodEnd,
});
