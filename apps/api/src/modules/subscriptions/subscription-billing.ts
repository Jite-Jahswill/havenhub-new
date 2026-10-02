import type { BillingInterval, SubscriptionChangeType } from '@havenhub/shared';

/**
 * HavenHub's subscription billing rules, in one place. There is no
 * proration and no automatic renewal (the payment abstraction cannot charge
 * a stored card); every term is paid in full, up front.
 *
 *   No paid term            → NEW       starts now
 *   Same plan as the term   → RENEWAL   starts when the current term ends
 *   Higher-ranked plan      → UPGRADE   starts now; the current term ends
 *                                       immediately, unused time forfeited
 *   Lower/equal-ranked plan → DOWNGRADE starts when the current term ends
 *
 * If a paid term is already queued, a further purchase is queued after it.
 */
export interface BillingTerm {
  planId: string;
  rank: number;
  currentPeriodEnd: Date;
}

export interface ChangePlan {
  changeType: SubscriptionChangeType;
  startsImmediately: boolean;
  startsAt: Date;
  endsAt: Date;
  /** The term that ends now (upgrades only). */
  replaces: 'current' | null;
}

export function planChange(
  target: { id: string; rank: number; billingInterval: BillingInterval },
  current: BillingTerm | null,
  queued: BillingTerm | null,
  now: Date,
): ChangePlan {
  const last = queued ?? current;
  const startNow = (changeType: SubscriptionChangeType, replaces: 'current' | null) => ({
    changeType,
    startsImmediately: true,
    startsAt: now,
    endsAt: addInterval(now, target.billingInterval),
    replaces,
  });
  if (!last) return startNow('NEW', null);

  const changeType: SubscriptionChangeType =
    target.id === last.planId ? 'RENEWAL' : target.rank > last.rank ? 'UPGRADE' : 'DOWNGRADE';
  if (changeType === 'UPGRADE' && !queued) return startNow('UPGRADE', 'current');

  const startsAt = last.currentPeriodEnd > now ? last.currentPeriodEnd : now;
  return {
    changeType,
    startsImmediately: startsAt.getTime() === now.getTime(),
    startsAt,
    endsAt: addInterval(startsAt, target.billingInterval),
    replaces: null,
  };
}

/**
 * Calendar arithmetic in UTC. Month ends clamp: 31 Jan + 1 month = 28/29
 * Feb, and 29 Feb + 1 year = 28 Feb.
 */
export function addInterval(from: Date, interval: BillingInterval): Date {
  const months = interval === 'YEARLY' ? 12 : 1;
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function changeNotes(
  change: ChangePlan,
  current: { planName: string; periodEnd: Date } | null,
  formatDate: (d: Date) => string,
): string[] {
  const notes: string[] = [
    'Plans do not renew automatically; you will be reminded before the term ends.',
  ];
  if (change.changeType === 'UPGRADE' && change.replaces && current) {
    notes.unshift(
      `Your ${current.planName} plan ends as soon as payment is verified. Its unused time (until ${formatDate(current.periodEnd)}) is not refunded or credited — HavenHub does not prorate.`,
    );
  }
  if (!change.startsImmediately) {
    notes.unshift(
      `You pay now; the new term starts on ${formatDate(change.startsAt)}, when your current term ends. Until then your current plan and limits stay.`,
    );
  }
  return notes;
}
