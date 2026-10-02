import type {
  AgentSubscriptionView,
  SubscriptionPaymentView,
  SubscriptionPlanView,
} from '@havenhub/shared';

import { koboToNumber } from '../../common/money';
import type {
  AgentSubscription,
  SubscriptionPayment,
  SubscriptionPlan,
} from '../../generated/prisma/client';
import { entitlementsOf } from '../plans/entitlements';
import type { PlanWithEntitlements } from '../plans/plan-limits.service';

export const PLAN_INCLUDE = { entitlements: true } as const;

export const toPlanView = (p: PlanWithEntitlements): SubscriptionPlanView => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  description: p.description,
  status: p.status,
  isDefault: p.isDefault,
  priceKobo: koboToNumber(p.priceKobo),
  currency: p.currency,
  billingInterval: p.billingInterval,
  rank: p.rank,
  features: p.features,
  entitlements: entitlementsOf(p),
});

export type TermRow = AgentSubscription & { plan: Pick<SubscriptionPlan, 'id' | 'name' | 'slug'> };
export const TERM_INCLUDE = { plan: { select: { id: true, name: true, slug: true } } } as const;

export const toSubscriptionView = (s: TermRow): AgentSubscriptionView => ({
  id: s.id,
  plan: s.plan,
  status: s.status,
  changeType: s.changeType,
  priceKobo: koboToNumber(s.priceKobo),
  currency: s.currency,
  billingInterval: s.billingInterval,
  currentPeriodStart: s.currentPeriodStart.toISOString(),
  currentPeriodEnd: s.currentPeriodEnd.toISOString(),
  startedAt: s.startedAt?.toISOString() ?? null,
  cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  cancelledAt: s.cancelledAt?.toISOString() ?? null,
  endedAt: s.endedAt?.toISOString() ?? null,
  endReason: s.endReason,
  createdAt: s.createdAt.toISOString(),
});

export const toSubscriptionPaymentView = (p: SubscriptionPayment): SubscriptionPaymentView => ({
  id: p.id,
  reference: p.reference,
  planId: p.planId,
  planName: p.planName,
  amountKobo: koboToNumber(p.amountKobo),
  currency: p.currency,
  billingInterval: p.billingInterval,
  provider: p.provider,
  status: p.status,
  failureReason: p.failureReason,
  subscriptionId: p.subscriptionId,
  paidAt: p.paidAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
});

/** "2 Nov 2026" in Nigerian time, for emails and billing notes. */
export const formatDay = (d: Date) =>
  d.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });
