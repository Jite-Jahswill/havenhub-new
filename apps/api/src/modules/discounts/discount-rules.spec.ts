import { describe, expect, it } from 'vitest';

import { evaluateCode, type CodeFacts, type UseFacts, type UseTarget } from './discount-rules';

const now = new Date('2026-10-09T12:00:00Z');
const code = (over: Partial<CodeFacts> = {}): CodeFacts => ({
  scope: 'SUBSCRIPTION',
  active: true,
  percentOff: 10,
  amountOffKobo: null,
  planIds: [],
  agentProfileIds: [],
  ownerAgentProfileId: null,
  propertyIds: [],
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  perUserLimit: 1,
  usedTotal: 0,
  usedByUser: 0,
  ...over,
});
const plan: UseTarget = {
  kind: 'PLAN',
  agentProfileId: 'agent-1',
  planId: 'plan-pro',
  planName: 'Pro',
};
const property: UseTarget = {
  kind: 'PROPERTY',
  propertyId: 'prop-1',
  ownerAgentProfileId: 'owner-1',
};
const use = (target: UseTarget = plan, priceKobo = 1_500_000): UseFacts => ({
  target,
  priceKobo,
  now,
});
const reason = (c: CodeFacts | null, u: UseFacts = use()) => {
  const r = evaluateCode(c, u);
  return r.ok ? null : r.reason;
};
const promo = (over: Partial<CodeFacts> = {}) =>
  code({ scope: 'BOOKING', ownerAgentProfileId: 'owner-1', ...over });

describe('evaluateCode', () => {
  it('takes a percentage (rounded down) or a fixed amount off', () => {
    expect(evaluateCode(code({ percentOff: 15 }), use(plan, 999_999))).toEqual({
      ok: true,
      amountOffKobo: 149_999,
    });
    expect(evaluateCode(code({ percentOff: null, amountOffKobo: 500_000 }), use())).toEqual({
      ok: true,
      amountOffKobo: 500_000,
    });
  });

  it('hides unknown, inactive, wrong-kind and other-agent codes behind one message', () => {
    for (const c of [
      null,
      code({ active: false }),
      code({ scope: 'BOOKING' }),
      code({ agentProfileIds: ['agent-2'] }),
    ]) {
      expect(reason(c)).toBe('This code is not valid.');
    }
    expect(reason(code({ agentProfileIds: ['agent-2', 'agent-1'] }))).toBeNull();
  });

  it('respects the date window (end is exclusive)', () => {
    expect(reason(code({ startsAt: new Date('2026-10-10T00:00:00Z') }))).toMatch(/not active yet/);
    expect(reason(code({ endsAt: now }))).toMatch(/expired/);
    expect(reason(code({ endsAt: new Date(now.getTime() + 1) }))).toBeNull();
  });

  it('applies only to its plans', () => {
    expect(reason(code({ planIds: ['plan-basic'] }))).toBe(
      'This code does not apply to the Pro plan.',
    );
    expect(reason(code({ planIds: ['plan-basic', 'plan-pro'] }))).toBeNull();
  });

  it('enforces per-person and total limits', () => {
    expect(reason(code({ usedByUser: 1 }))).toMatch(/already used/);
    expect(reason(code({ perUserLimit: 2, usedByUser: 1 }))).toBeNull();
    expect(reason(code({ maxRedemptions: 5, usedTotal: 5 }))).toMatch(/fully used/);
    expect(reason(code({ maxRedemptions: 5, usedTotal: 4 }))).toBeNull();
  });

  it('never brings the charge below the minimum', () => {
    expect(reason(code({ percentOff: null, amountOffKobo: 1_495_000 }))).toMatch(/below ₦100/);
    expect(reason(code({ percentOff: null, amountOffKobo: 1_490_000 }))).toBeNull();
    // A fixed amount larger than the price is capped at the price — then refused.
    expect(reason(code({ percentOff: null, amountOffKobo: 9_000_000 }))).toMatch(/below/);
  });
});

describe('evaluateCode for property bookings', () => {
  it('only works on the owning agent’s properties, and only as a booking code', () => {
    expect(reason(promo(), use(property))).toBeNull();
    expect(reason(promo({ ownerAgentProfileId: 'owner-2' }), use(property))).toBe(
      'This code is not valid.',
    );
    // A plan code is not a booking code, and a booking code is not a plan code.
    expect(reason(code(), use(property))).toBe('This code is not valid.');
    expect(reason(promo(), use(plan))).toBe('This code is not valid.');
  });

  it('can be limited to some of the agent’s properties', () => {
    expect(reason(promo({ propertyIds: ['prop-2'] }), use(property))).toBe(
      'This code does not apply to this property.',
    );
    expect(reason(promo({ propertyIds: ['prop-2', 'prop-1'] }), use(property))).toBeNull();
  });
});
