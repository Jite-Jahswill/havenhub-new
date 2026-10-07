import { MIN_DISCOUNTED_CHARGE_KOBO, discountAmountKobo, formatKobo } from '@havenhub/shared';

/** What decides whether a code can be used, as plain data (no database). */
export interface CodeFacts {
  scope: string;
  active: boolean;
  percentOff: number | null;
  amountOffKobo: number | null;
  /** Plan codes: plans it applies to (empty = all paid plans). */
  planIds: string[];
  /** Plan codes: agents who may use it (empty = any agent). */
  agentProfileIds: string[];
  /** Booking codes: the agent who offers it. */
  ownerAgentProfileId: string | null;
  /** Booking codes: the owner's properties it applies to (empty = all of them). */
  propertyIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  /** Uses that count: paid, plus checkouts or bookings still awaiting payment. */
  usedTotal: number;
  usedByUser: number;
}

/** What the code is being used on. */
export type UseTarget =
  | { kind: 'PLAN'; agentProfileId: string; planId: string; planName: string }
  | { kind: 'PROPERTY'; propertyId: string; ownerAgentProfileId: string };

export interface UseFacts {
  target: UseTarget;
  /** What the code may reduce: the plan price, or the stay after the listing discount. */
  priceKobo: number;
  now: Date;
}

export type Evaluation = { ok: true; amountOffKobo: number } | { ok: false; reason: string };

const NOT_VALID = 'This code is not valid.';

/**
 * The single decision on whether a code applies. Codes restricted to other
 * agents (plans) or offered by another agent (bookings) look exactly like
 * unknown codes, so nobody can probe who they are for.
 */
export function evaluateCode(code: CodeFacts | null, use: UseFacts): Evaluation {
  if (!code || !code.active) return { ok: false, reason: NOT_VALID };
  const { target } = use;
  if (target.kind === 'PLAN') {
    if (code.scope !== 'SUBSCRIPTION') return { ok: false, reason: NOT_VALID };
    if (code.agentProfileIds.length > 0 && !code.agentProfileIds.includes(target.agentProfileId)) {
      return { ok: false, reason: NOT_VALID };
    }
  } else if (code.scope !== 'BOOKING' || code.ownerAgentProfileId !== target.ownerAgentProfileId) {
    return { ok: false, reason: NOT_VALID };
  }
  if (code.startsAt && use.now < code.startsAt) {
    return { ok: false, reason: 'This code is not active yet.' };
  }
  if (code.endsAt && use.now >= code.endsAt) {
    return { ok: false, reason: 'This code has expired.' };
  }
  if (target.kind === 'PLAN' && code.planIds.length > 0 && !code.planIds.includes(target.planId)) {
    return { ok: false, reason: `This code does not apply to the ${target.planName} plan.` };
  }
  if (
    target.kind === 'PROPERTY' &&
    code.propertyIds.length > 0 &&
    !code.propertyIds.includes(target.propertyId)
  ) {
    return { ok: false, reason: 'This code does not apply to this property.' };
  }
  if (code.usedByUser >= code.perUserLimit) {
    return { ok: false, reason: 'You have already used this code.' };
  }
  if (code.maxRedemptions !== null && code.usedTotal >= code.maxRedemptions) {
    return { ok: false, reason: 'This code has been fully used.' };
  }
  const amountOffKobo = discountAmountKobo(use.priceKobo, code);
  if (use.priceKobo - amountOffKobo < MIN_DISCOUNTED_CHARGE_KOBO) {
    return {
      ok: false,
      reason: `This code cannot be used here: the price would be below ${formatKobo(MIN_DISCOUNTED_CHARGE_KOBO)}.`,
    };
  }
  if (amountOffKobo <= 0) return { ok: false, reason: NOT_VALID };
  return { ok: true, amountOffKobo };
}
