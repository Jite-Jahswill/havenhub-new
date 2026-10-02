import { describe, expect, it } from 'vitest';

import { addInterval, planChange } from './subscription-billing';

const d = (iso: string) => new Date(iso);
const now = d('2026-10-02T10:00:00.000Z');
const starter = { id: 'starter', rank: 1, billingInterval: 'MONTHLY' as const };
const pro = { id: 'pro', rank: 2, billingInterval: 'YEARLY' as const };
const term = (planId: string, rank: number, end: string) => ({
  planId,
  rank,
  currentPeriodEnd: d(end),
});

describe('addInterval', () => {
  it('adds calendar months and years in UTC', () => {
    expect(addInterval(d('2026-10-02T10:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2026-11-02T10:00:00.000Z',
    );
    expect(addInterval(d('2026-10-02T10:00:00Z'), 'YEARLY').toISOString()).toBe(
      '2027-10-02T10:00:00.000Z',
    );
  });

  it('clamps month ends instead of overflowing', () => {
    expect(addInterval(d('2027-01-31T00:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    );
    expect(addInterval(d('2028-01-31T00:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(addInterval(d('2028-02-29T00:00:00Z'), 'YEARLY').toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
    expect(addInterval(d('2026-12-15T00:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
  });
});

describe('planChange', () => {
  it('a first paid plan starts now', () => {
    expect(planChange(starter, null, null, now)).toEqual({
      changeType: 'NEW',
      startsImmediately: true,
      startsAt: now,
      endsAt: d('2026-11-02T10:00:00.000Z'),
      replaces: null,
    });
  });

  it('buying the same plan renews it from the end of the current term', () => {
    const change = planChange(starter, term('starter', 1, '2026-10-20T00:00:00Z'), null, now);
    expect(change).toMatchObject({
      changeType: 'RENEWAL',
      startsImmediately: false,
      startsAt: d('2026-10-20T00:00:00Z'),
      endsAt: d('2026-11-20T00:00:00Z'),
    });
  });

  it('a higher-ranked plan upgrades immediately and replaces the current term', () => {
    const change = planChange(pro, term('starter', 1, '2026-10-20T00:00:00Z'), null, now);
    expect(change).toMatchObject({
      changeType: 'UPGRADE',
      startsImmediately: true,
      startsAt: now,
      endsAt: d('2027-10-02T10:00:00.000Z'),
      replaces: 'current',
    });
  });

  it('a lower- or equal-ranked plan is a downgrade that waits for the current term', () => {
    const fromPro = term('pro', 2, '2027-01-01T00:00:00Z');
    expect(planChange(starter, fromPro, null, now)).toMatchObject({
      changeType: 'DOWNGRADE',
      startsImmediately: false,
      startsAt: d('2027-01-01T00:00:00Z'),
      replaces: null,
    });
    const sameRank = { id: 'starter-yearly', rank: 1, billingInterval: 'YEARLY' as const };
    expect(
      planChange(sameRank, term('starter', 1, '2026-12-01T00:00:00Z'), null, now),
    ).toMatchObject({ changeType: 'DOWNGRADE', startsAt: d('2026-12-01T00:00:00Z') });
  });

  it('with a term already queued, further purchases queue after it — never overlap', () => {
    const current = term('starter', 1, '2026-10-20T00:00:00Z');
    const queued = term('starter', 1, '2026-11-20T00:00:00Z');
    expect(planChange(pro, current, queued, now)).toMatchObject({
      changeType: 'UPGRADE',
      startsImmediately: false,
      startsAt: d('2026-11-20T00:00:00Z'),
      replaces: null,
    });
  });
});
